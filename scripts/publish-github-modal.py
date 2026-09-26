"""Validate, commit and push to GitHub, then deploy the same app to Modal."""
import argparse
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
PROFILE = "bytx24"
REMOTES = {"https://github.com/bytx88/meme-fast.git", "git@github.com:bytx88/meme-fast.git"}


def run(*args, capture=False, env=None):
    result = subprocess.run(args, cwd=ROOT, env=env, text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None)
    if result.returncode:
        if capture and result.stderr:
            print(result.stderr.strip(), file=sys.stderr)
        raise RuntimeError(f"Command failed (exit {result.returncode}): {args[0]}")
    return result.stdout.strip() if capture else ""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate locally without committing, pushing or deploying")
    parser.add_argument("--message", default="Update Meme Fast", help="Git commit message")
    args = parser.parse_args()
    for command in ("git", "node"):
        if not shutil.which(command):
            raise RuntimeError(f"{command} is not installed or not on PATH.")
    if run("git", "branch", "--show-current", capture=True) != "main":
        raise RuntimeError("Switch to the main branch before publishing.")
    remote = run("git", "remote", "get-url", "--push", "origin", capture=True)
    if remote not in REMOTES:
        raise RuntimeError("origin must point to bytx88/meme-fast on GitHub.")
    if run("git", "ls-files", "--unmerged", capture=True):
        raise RuntimeError("Resolve merge conflicts before publishing.")
    if importlib.util.find_spec("modal") is None:
        raise RuntimeError("Modal is missing. Install it with: py -m pip install modal")
    if sys.platform == "win32" and importlib.util.find_spec("truststore") is None:
        raise RuntimeError("Windows certificate support is missing. Install it with: py -m pip install truststore")
    config_path = Path(os.environ.get("MODAL_CONFIG_PATH", Path.home() / ".modal.toml"))
    try:
        config = tomllib.loads(config_path.read_text(encoding="utf-8"))
        profile = config[PROFILE]
        if not profile.get("token_id") or not profile.get("token_secret"):
            raise KeyError(PROFILE)
    except (OSError, ValueError, KeyError):
        raise RuntimeError("The bytx24 Modal profile needs login credentials. Run: py -m modal setup") from None

    print("Validating Meme Fast for GitHub bytx88/meme-fast and Modal bytx24...", flush=True)
    run("git", "diff", "--check")
    run("git", "diff", "--cached", "--check")
    tests = sorted(str(path.relative_to(ROOT)) for path in (ROOT / "test").glob("*.test.mjs"))
    if not tests:
        raise RuntimeError("No project tests were found.")
    run("node", "--test", *tests)
    run("node", "scripts/build-worker.mjs")
    run("node", "--check", "dist/server/index.js")
    compile((ROOT / "modal_app.py").read_text(encoding="utf-8"), "modal_app.py", "exec")
    if args.check:
        print("Checks passed. No commit, push or deployment was performed.")
        print("Modal profile exists locally; online credentials were not verified.")
        return

    print("Committing project changes and pushing GitHub...", flush=True)
    run("git", "add", "--all")
    if run("git", "diff", "--cached", "--name-only", capture=True):
        run("git", "commit", "-m", args.message)
    else:
        print("No new changes to commit.")
    run("git", "push", "origin", "HEAD:refs/heads/main")
    print("GitHub updated. Deploying Modal app meme-fast with profile bytx24...", flush=True)
    env = os.environ.copy()
    env["MODAL_PROFILE"] = PROFILE
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    # Use this named profile, not credentials or an environment inherited from another workspace.
    for key in ("MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET", "MODAL_ENVIRONMENT"):
        env.pop(key, None)
    if sys.platform == "win32":
        # Modal's Python client needs the Windows trust store on machines with
        # a locally trusted TLS issuer that is absent from certifi.
        modal_cli = (
            "import runpy,sys,truststore;"
            "truststore.inject_into_ssl();"
            "sys.argv=['modal','deploy','modal_app.py'];"
            "runpy.run_module('modal',run_name='__main__')"
        )
        run(sys.executable, "-c", modal_cli, env=env)
    else:
        run(sys.executable, "-m", "modal", "deploy", "modal_app.py", env=env)
    print("Done: GitHub updated and Modal deployment completed.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.SubprocessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("Publishing canceled.", file=sys.stderr)
        sys.exit(130)
