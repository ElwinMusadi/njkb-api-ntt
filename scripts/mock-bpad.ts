import { createServer } from 'node:http';

const vehicle2024={
 NOPOL:'DH4786PD',JenisKendaraan:'SEPEDA MOTOR',Merk:'HONDA',KD_MERK:'167',
 Type:'C1M02N42L1 A/T',KD_TIPE:'701167 08549',TahunPembuatan:2024
};
const vehicle2026={
 NOPOL:'DH2026ZZ',JenisKendaraan:'SEPEDA MOTOR',Merk:'HONDA',KD_MERK:'167',
 Type:'C1M02N42L1 A/T',KD_TIPE:'701167 67749',TahunPembuatan:2026
};

const server=createServer((request,response)=>{
 if(request.method!=='POST') {response.writeHead(405).end();return;}
 let body='';
 request.setEncoding('utf8');
 request.on('data',chunk=>body+=chunk);
 request.on('end',()=>{
  try {
   const parsed=JSON.parse(body) as {nopol?:string};
   const vehicle=parsed.nopol==='DH4786PD'?vehicle2024:parsed.nopol==='DH2026ZZ'?vehicle2026:null;
   if(!vehicle) {response.writeHead(404,{'content-type':'application/json'}).end(JSON.stringify({error:'not found'}));return;}
   response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(vehicle));
  } catch {response.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:'bad request'}));}
 });
});

server.listen(8788,'127.0.0.1',()=>console.log('Mock BPAD listening on http://127.0.0.1:8788'));
