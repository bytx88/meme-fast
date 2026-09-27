import unittest
from worker.refresh_priority import valid_priority_ids


class RefreshPriorityTest(unittest.TestCase):
    def test_validation_and_identity(self):
        self.assertEqual(valid_priority_ids(["base:0x" + "A" * 40]), ["base:0x" + "a" * 40])
        self.assertEqual(valid_priority_ids(["solana:" + "A" * 32]), ["solana:" + "A" * 32])
        for ids in ([], ["bad"], ["base:0x" + "a" * 40] * 31, "bad", [None]):
            with self.assertRaises(ValueError):
                valid_priority_ids(ids)
