import type { MetadataRoute } from "next";
export default function manifest():MetadataRoute.Manifest{return{name:"햄쮸터 알고리즘",short_name:"햄쮸터",description:"GitHub 풀이 기록으로 자동 인증하는 알고리즘 스터디",start_url:"/",display:"standalone",background_color:"#f7f7f4",theme_color:"#1f261f",icons:[{src:"/icon.svg",sizes:"any",type:"image/svg+xml"}]}}
