const RAW_COLUMNS=['NO','KODING','MERK','TYPE','TAHUN_BUAT','NJKB','BOBOT','DP_PKB'] as const;
const META_COLUMNS=['pdf_page','source_row','section','vehicle_category','review_status','review_note'] as const;

export function parseCsv(text:string):string[][] {
 const rows:string[][]=[];let row:string[]=[];let field='';let quoted=false;
 for(let i=0;i<text.length;i++) {
  const char=text[i];
  if(quoted) {
   if(char==='"'&&text[i+1]==='"') {field+='"';i++;}
   else if(char==='"') quoted=false;
   else field+=char;
  } else if(char==='"') {
   if(field.length!==0) throw new Error('Malformed CSV quote');
   quoted=true;
  } else if(char===',') {row.push(field);field='';}
  else if(char==='\n'||char==='\r') {
   if(char==='\r'&&text[i+1]==='\n') i++;
   row.push(field);rows.push(row);row=[];field='';
  } else field+=char;
 }
 if(quoted) throw new Error('Unclosed CSV quote');
 if(field.length>0||row.length>0) {row.push(field);rows.push(row);}
 return rows.filter(values=>values.some(value=>value.length>0));
}

export function csvRecords(text:string):unknown[] {
 const rows=parseCsv(text);
 if(rows.length===0) return [];
 const headers=rows[0].map(value=>value.trim());
 if(new Set(headers).size!==headers.length||headers.some(value=>value==='')) throw new Error('CSV headers must be non-empty and unique');
 const required=[...META_COLUMNS,...RAW_COLUMNS];
 for(const column of required) if(!headers.includes(column)) throw new Error(`Missing canonical CSV column: ${column}`);
 return rows.slice(1).map((values,index)=>{
  if(values.length!==headers.length) return {__malformed_csv_row:values,__csv_line:index+2,
   __error:`Expected ${headers.length} columns, received ${values.length}`};
  const cells=Object.fromEntries(headers.map((header,column)=>[header,values[column]]));
  return {
   source:{pdf_page:cells.pdf_page,source_row:cells.source_row,
    ...(cells.section?{section:cells.section}:{}),...(cells.vehicle_category?{vehicle_category:cells.vehicle_category}:{})},
   raw:Object.fromEntries(RAW_COLUMNS.map(column=>[column,cells[column]])),
   review:{status:cells.review_status,note:cells.review_note}
  };
 });
}
