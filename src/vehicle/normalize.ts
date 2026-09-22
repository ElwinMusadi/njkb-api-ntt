import type { BpadVehicle } from '../bpad/adapter';
import { normalize } from '../db/import';

export interface NormalizedVehicle {
 vehicleCategory:string;brand:string;brandCode:string;type:string;typeCode:string;vehicleYear:number;
}
const categoryAliases:Record<string,string>={
 'SEPEDA MOTOR':'SEPEDA MOTOR RODA DUA',
 'SEPEDA MOTOR RODA 2':'SEPEDA MOTOR RODA DUA',
 'SEPEDA MOTOR RODA DUA':'SEPEDA MOTOR RODA DUA'
};
const categoryPrefixes:[string,string][]=[
 ['MOBIL PENUMPANG','MOBIL PENUMPANG'],
 ['MOBIL BARANG','MOBIL BARANG'],
 ['MOBIL BUS','BUS'],
 ['BUS','BUS']
];
export function normalizeVehicle(vehicle:BpadVehicle):NormalizedVehicle {
 const category=normalize(vehicle.vehicleCategory);
 const vehicleCategory=categoryAliases[category]??categoryPrefixes.find(([prefix])=>category.startsWith(prefix))?.[1]??category;
 return {vehicleCategory,brand:normalize(vehicle.brand),
  brandCode:normalize(vehicle.brandCode),type:normalize(vehicle.type),typeCode:normalize(vehicle.typeCode),
  vehicleYear:vehicle.vehicleYear};
}
