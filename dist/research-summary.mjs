const FALLBACK='Unverified lead · inspect source in Details';
const NOISE=/\b(?:file type:|file size:|resolution:|view all \d+ images|load \d+ comments|enjoy the videos and music you love|photo by .{0,80} from freepik|see more .{0,80} images on know your meme)/i;

function compact(value){
 const text=String(value??'').replace(/\[[^\]]+\]\([^)]*\)/g,'').replace(/\(?https?:\/\/\S+\)?/g,'').replace(/\buddg=\S+/g,'').replace(/\s+/g,' ').trim();
 if(!text||NOISE.test(text))return '';
 if(text.length<=140)return text;
 const end=text.lastIndexOf(' ',140);
 return `${text.slice(0,end>90?end:140).trimEnd()}…`;
}

export function researchSummary(found,checked){
 if(!found)return checked==='searching'?'Checking context…':checked==='error'?'Source unavailable':'Context pending';
 const source=found.articles?.[0]?.title||found.web?.snippet||found.web?.title||found.profile?.description;
 return compact(source)||FALLBACK;
}
