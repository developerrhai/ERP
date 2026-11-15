// One fixed seed: the same users every run. Fictitious names only.
export type Plant = 'Talwade' | 'Sawardari' | 'Varale';
export interface FeedUser {
  loginId: string;
  name: string;
  role: string;
  dept: string;
  plants: Plant[];
  limit?: number;
}
const T: Plant = 'Talwade';
const S: Plant = 'Sawardari';
const V: Plant = 'Varale';

export const USERS: FeedUser[] = [
  { loginId: 'dir.kulkarni', name: 'Anil Kulkarni', role: 'Director', dept: 'Administration', plants: [T, S, V], limit: 1000000 },
  { loginId: 'dir.joshi', name: 'Meera Joshi', role: 'Director', dept: 'Administration', plants: [T, S, V], limit: 1000000 },
  { loginId: 'cfo.deshpande', name: 'Rahul Deshpande', role: 'CFO', dept: 'Finance', plants: [T, S, V], limit: 1000000 },
  { loginId: 'gm.patil', name: 'Sunil Patil', role: 'General Manager', dept: 'Production', plants: [T, S], limit: 1000000 },
  { loginId: 'gm.shinde', name: 'Kavita Shinde', role: 'General Manager', dept: 'Sales', plants: [S, V], limit: 1000000 },
  { loginId: 'head.sales', name: 'Vikram More', role: 'Department Head', dept: 'Sales', plants: [T, S], limit: 200000 },
  { loginId: 'head.purchase', name: 'Neha Gokhale', role: 'Department Head', dept: 'Purchase', plants: [T], limit: 200000 },
  { loginId: 'head.warehouse', name: 'Prakash Jadhav', role: 'Department Head', dept: 'Warehouse', plants: [T, S], limit: 200000 },
  { loginId: 'head.production', name: 'Ajay Pawar', role: 'Department Head', dept: 'Production', plants: [T, S, V], limit: 200000 },
  { loginId: 'head.quality', name: 'Smita Bhosale', role: 'Department Head', dept: 'Quality', plants: [T, S], limit: 200000 },
  { loginId: 'head.finance', name: 'Girish Naik', role: 'Department Head', dept: 'Finance', plants: [T, S, V], limit: 200000 },
  { loginId: 'head.hr', name: 'Pooja Kale', role: 'Department Head', dept: 'HR', plants: [T, S, V], limit: 200000 },
  { loginId: 'mgr.purchase.tal', name: 'Sachin Gaikwad', role: 'Department Manager', dept: 'Purchase', plants: [T], limit: 50000 },
  { loginId: 'mgr.purchase.saw', name: 'Rekha Mane', role: 'Department Manager', dept: 'Purchase', plants: [S], limit: 50000 },
  { loginId: 'mgr.sales.tal', name: 'Nitin Chavan', role: 'Department Manager', dept: 'Sales', plants: [T, S], limit: 50000 },
  { loginId: 'mgr.stores.tal', name: 'Dinesh Thorat', role: 'Department Manager', dept: 'Warehouse', plants: [T], limit: 50000 },
  { loginId: 'mgr.production.saw', name: 'Santosh Kamble', role: 'Department Manager', dept: 'Production', plants: [S], limit: 50000 },
  { loginId: 'mgr.quality.tal', name: 'Anita Salunkhe', role: 'Department Manager', dept: 'Quality', plants: [T], limit: 50000 },
  { loginId: 'mgr.finance', name: 'Mukesh Rane', role: 'Department Manager', dept: 'Finance', plants: [T, S, V], limit: 50000 },
  { loginId: 'mgr.hr', name: 'Swati Dange', role: 'Department Manager', dept: 'HR', plants: [T, S], limit: 50000 },
  { loginId: 'sup.production.tal', name: 'Ganesh Wagh', role: 'Supervisor', dept: 'Production', plants: [T] },
  { loginId: 'sup.production.saw', name: 'Ramesh Gawade', role: 'Supervisor', dept: 'Production', plants: [S] },
  { loginId: 'sup.quality.var', name: 'Yogesh Sawant', role: 'Supervisor', dept: 'Quality', plants: [V] },
  { loginId: 'sup.maintenance', name: 'Dattatray Ghule', role: 'Supervisor', dept: 'Maintenance', plants: [T, S] },
  { loginId: 'emp.stores.tal', name: 'Mahesh Kadam', role: 'Employee', dept: 'Warehouse', plants: [T] },
  { loginId: 'emp.stores.saw', name: 'Sandeep Londhe', role: 'Employee', dept: 'Warehouse', plants: [S] },
  { loginId: 'emp.sales.talsaw', name: 'Priya Nikam', role: 'Employee', dept: 'Sales', plants: [T, S] },
  { loginId: 'emp.purchase.tal', name: 'Rohit Sonawane', role: 'Employee', dept: 'Purchase', plants: [T] },
  { loginId: 'emp.hr.var', name: 'Manisha Bhor', role: 'Employee', dept: 'HR', plants: [V] },
  { loginId: 'emp.engineering', name: 'Tushar Ghadge', role: 'Employee', dept: 'Engineering', plants: [T, S] },
  { loginId: 'emp.service', name: 'Omkar Dalvi', role: 'Employee', dept: 'Service', plants: [S, V] },
];
