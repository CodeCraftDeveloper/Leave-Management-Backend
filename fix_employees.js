import mongoose from 'mongoose';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { normalizeDepartmentName } from './utils/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '.env');
const envContent = readFileSync(envPath, 'utf8');
const MONGO_URI = Object.fromEntries(
  envContent.split('\n').filter(l => l.trim()).map(l => {
    const idx = l.indexOf('=');
    return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
  })
).MONGO_URI;

const employeeData = [
["H694","DILEEP SINGH CHANDEL","Production"],
["H2","SHRI PRAKASH SINGH","Maintenance"],
["H4","SATENDRA KUMAR KATIYAR","Production"],
["H336","PAWAN KUMAR","Production"],
["H34","RAJAN KUMAR","Hr & Admin"],
["H482","VIMLASH","Hr"],
["H532","RADHIKA RANI","Accounts"],
["H317","PRAVEEN KUMAR","Accounts"],
["H545","BHARAT BHUSHAN","Accounts"],
["H704","SATISH KUMAR","Accounts"],
["H495","REKHA CHINDALIYA","E-com"],
["H616","ABHAY","E-com"],
["H624","EKTA KUMARI","Pre -Press"],
["H641","Shikhar Tripathi","Digital Market"],
["H666","CHANDI CHARAN MAHATO","Digital Market"],
["H386","PRADEEP","Digital Market"],
["H602","DISHANT MISHRA","Digital Market"],
["H689","KARAMJEET KUMAR","Digital Market"],
["RH242","KISHAN","Billing"],
["H701","VISHAL","EPR"],
["H568","UDHAM SINGH","Store"],
["H103","GAURAV KUMAR","Store"],
["H371","VIKRANT SHISHODIA","Store"],
["H620","KAMAL YADAV","Store"],
["H569","HIMANSHU PRAJAPATI","Store -Deo"],
["H60","OMENDRA PAL SINGH","Supervisor( Dispatch)"],
["RH277","AKSHAY VAIDWAN","Supervisor( Dispatch)"],
["H172","ASHWANI TYAGI","Supervisor(Production)"],
["H241","SATENDRA SINGH","Supervisor(Production)"],
["H354","ROOP CHAND","Supervisor(Production)"],
["H601","SANDEEP KUMAR","Supervisor(Production)"],
["H308","VIVEK MISHRA","Supervisor(Ink )"],
["H612","Srijan Thapliyal","Supervisor(Ink )"],
["H94","SANTOSH KUMAR MISHRA","Ppc"],
["H696","SUBODH KUMAR","PPC"],
["H476","HIMANSHU ","Ppc"],
["H592","VISHVENDRA SINGH TOMAR","Ppc-Deo"],
["H634","RAHUL CHAUCHAN","Ppc-Deo"],
["H695","AMIT KUMAR GUPTA","Maintenance"],
["RH11","PRASHANT KUMAR YADAV","Maintenance-Electrical"],
["H110","SATISH KUMAR","Maintenance-Electrical"],
["H522","RAJOO PRASAD","Maintenance-Electrical"],
["H423","Kaushlendra Kumar","Maintenance-Electrical"],
["H564","RAVINDRA","Maintenance-Electrical"],
["RH3","SUNIL KUMAR","Maintenance-Mechanical"],
["H431","SHIVAM KUMAR PATHAK","Maintenance-Mechanical"],
["H439","RAHUL KUSHWAHA","Maintenance-Mechanical"],
["H359","PRASHANT KUMAR","Maintenance-Mechanical"],
["H24","SANJAY SHARMA","Maintenance-Mechanical"],
["H470","RITESH  NISHAD","Maintenance-Mechanical"],
["H471","SABHARAJ","Maintenance-Mechanical"],
["H637","Ravindra Yadav","Maintenance-Welder"],
["H7","YOGESH KUMAR","Printing-cylinder"],
["H141","DHARMENDRA SINGH","Printing-cylinder"],
["H494","MANVENDRA SINGH","Printing-cylinder"],
["H447","BIRJESH YADAV","Printing -01"],
["H539","VIMAL KUMAR","Printing -01"],
["H589","AKHILESH KUMAR","Printing -01"],
["H598","GOPAL","Printing -01"],
["H599","DINESH KUMAR","Printing -01"],
["H575","SANTOSH KUMAR YADAV","Printing -01"],
["H604","ASHISH KUMAR","Printing -02"],
["H357","GOURAV TIWARI","Printing -02"],
["H461","Sachin","Printing -02"],
["H490","ANKIT KUMAR","Printing -02"],
["H491","RAHUL KUMAR","Printing -02"],
["H498","VIRENDRA PAL","Printing-Ink"],
["H501","RAHUL KUMAR","Printing-Ink"],
["H563","AJIT KUMAR","Printing-Ink"],
["H534","KHYATI PRASAD","Printing-Ink"],
["H558","RAVINDER KUMAR","Printing-Ink"],
["H660","AMIT KUMAR","Printing-Ink"],
["H682","AMIT KUMAR PANDEY","Printing-Ink"],
["H588","HARISH CHAND RAWAT","Printing-Incahrge"],
["H595","RAMDEEN","Printing-Incahrge"],
["H667","MUNIB YADAV","Printing -01"],
["H668","PRASHANT","Printing -02"],
["H678","PAWAN KUMAR ","Printing -02"],
["H683","RAHUL","Printing -02"],
["H703","ASHUTOSH","Printing -02"],
["H700","RABI KUMAR","Printing -01"],
["H16","ANKUR CHAUDHARY","Extrusion"],
["H37","AMARNATH SINGH","Extrusion"],
["H200","SHISHU LAL KUMAR","Extrusion"],
["H497","DANNU","Extrusion"],
["H628","AMRENDRA ","Extrusion"],
["H20","PRAVEEN KUMAR","Inspection"],
["H240","RAVI KUMAR","Inspection"],
["H530","RAKESH KUMAR","Inspection"],
["H615","Sarvesh Kumar","Inspection"],
["H691","SACHIN","Inspection"],
["H59","DEEPAK BISHT","Lamination - SOLVENT LESS"],
["H123","SATENDRA KUMAR","Lamination - SOLVENT LESS"],
["H228","SACHIN SHARMA","Lamination - SOLVENT LESS"],
["H282","SONU KUMAR","Lamination - SOLVENT LESS"],
["H524","PRAVEEN KUMAR","Lamination - SOLVENT LESS"],
["H605","VIKASH KUMAR","Lamination - SOLVENT LESS"],
["H623","VIKASH KUMAR","Lamination - SOLVENT LESS"],
["H626","RINKU","Lamination - SOLVENT LESS"],
["RH329","SHUBHAM","Lamination - SOLVENT LESS"],
["H647","YOGENDRA SINGH","Lamination - SOLVENT BASE"],
["H544","NAVNEET KUMAR","Lamination- NARENDRA"],
["H570","ANISH MISHRA","Lamination- NARENDRA"],
["H573","KAUSHAL","Lamination- NARENDRA"],
["H652","VIPIN PUNDIR","Lamination - SOLVENT LESS"],
["H388","Atul Kumar","Lamination - SOLVENT BASE"],
["H517","Surendra Kumar Yadav","Lamination - SOLVENT BASE"],
["H537","Sumit Kumar Sharma","Lamination- NARENDRA"],
["H574","SANJAY SINGH","Lamination - SOLVENT BASE"],
["H617","DIWAKAR NISHAD","Lamination - SOLVENT BASE"],
["H645","VIPIN PRAJAPATI","Lamination - SOLVENT BASE"],
["H576","PRABHAKAR","Lamination - SOLVENT BASE"],
["H692","KAPIL KUMAR","Lamination - SOLVENT LESS"],
["H698","VIKAS KUMAR","Lamination - SOLVENT BASE"],
["H699","UTTAM SINGH","Lamination - SOLVENT LESS"],
["H706","SANJAY KUMAR SINGH","Lamination- NARENDRA"],
["H51","PRAMOD SINGH SIKARWAR","Slitting"],
["H62","ROOPENDRA  KUMAR","Slitting"],
["H116","TEJVEER SINGH","Slitting"],
["H119","PUSHPENDRA KUMAR","Slitting"],
["H142","LAKSHMAN YADAV","Slitting"],
["H169","VINOD KUMAR","Slitting"],
["H328","SACHIN","Slitting"],
["H462","SAURABH KUMAR","Slitting"],
["H492","VINIT KUMAR","Slitting"],
["H496","AMIT KUMAR","Slitting"],
["H509","MUKESH","Slitting"],
["H510","PRAVESH KUMAR","Slitting"],
["H572","SHELENDRA","Slitting"],
["H582","SURYA KANT NIRALA","Slitting"],
["H594","AJAD GAURAV","Slitting"],
["H596","KAMAL SINGH","Slitting"],
["H633","RANJAN KUMAR","Slitting"],
["H680","NEERAJ ","Slitting"],
["H711","SANDEEP KUMAR","Quality"],
["H477","SUNIL KUMAR","Quality"],
["H533","NEERAJ KUMAR SINGH","Quality"],
["H542","AMAN RAJPAL","Quality"],
["H579","ANKIT","Quality"],
["H581","PRADEEP KUMAR","Quality"],
["H583","RAJESH KUMAR","Quality"],
["H587","DHEERENDRA SINGH","Quality"],
["H631","RAMESH KUMAR ","Quality"],
["H664","VIPIN","Quality"],
["H684","PRAJWAL ANIL RUIKAR","Quality"],
["H710","JAGAT SINGH","Quality"],
["H56","DIPOO KUMAR","Pouch"],
["H57","MOHAN MALIK","Pouch"],
["H86","KAPIL -3","Pouch"],
["H96","AMZAD KHAN","Pouch"],
["H104","MOHIT","Pouch"],
["H105","AVINASH","Pouch"],
["H161","SHAKTI SINGH","Pouch"],
["H163","LALIT KUMAR SHARMA","Pouch"],
["H184","SACHIN KUMAR","Pouch"],
["H231","ASHWANI KUMAR","Pouch"],
["H232","DHARMENDRA BIND","Pouch"],
["H262","ARUN SINGH","Pouch"],
["H299","JITENDER KUMAR","Pouch"],
["H307","YATENDRA","Pouch"],
["H343","RAM YAGYA","Pouch"],
["H369","PARAS","Pouch"],
["H443","RAJENDRA PRASAD","Pouch"],
["H504","YASH KUMAR","Pouch"],
["H356","RITESH SINGH","Pouch"],
["RH250","RAMESH","Pouch"],
["H610","VIRENDRA","Pouch"],
["H630","GAURAV KUMAR","Pouch"],
["H541","ROHIT KUMAR","Pouch"],
["H655","JITENDRA SINGH","Pouch"],
["H657","LOKESH KUMAR TOMAR","Pouch"],
["RH227","DEEPAK KUMAR","Pouch"],
["H661","RAVI KUMAR","Pouch"],
["H663","SAURABH KUMAR","Pouch"],
["H665","SOHAN PAL","Pouch"],
["RH84","KAPIL KUMAR","Pouch"],
["H705","SACHIN KUMAR","Pouch"],
["H709","SHUBHAM","Pouch"],
["H712","YATISH","Pouch"],
["H426","RANJAN","Boiler"],
["H326","BIPIN KUMAR","Pantry"],
["H653","DEEPAK KUMAR","Pantry"],
["H456","ASHISH YADAV","Forlift"],
["H646","RAVIKANT","Forlift"],
["H649","RADHE MOHAN","Forlift"],
["H687","Surya Nath Mishra","WAREHOUSE"],
["Z1","SURESH SINGH","WAREHOUSE"],
["H713","DEV RATAN TIWARI","Extrusion"],
["H714","Rovin","Pouch"],
["H715","Nitish Kumar","Maintenance"],
["H716","Anil Kumar","Forklift"],
["H721","Ashutosh Gautam","Maintenance"],
["H526","SULTAN SINGH","DRIVER"],
["H690","BRIJESH","DRIVER"],
["H679","GAJENDRA","DRIVER"],
["H12","MOHAN","Blown Film"],
["H18","RAMRAJ","Blown Film"],
["H100","SUNIL KUMAR","Blown Film"],
["H273","BHARAT PRASAD","Blown Film - Recycle"],
["H717","Umesh Kumar","Blown -Film Unit -4"],
["H718","Shobhit","Blown -Film Unit -4"],
["H719","Jitendra Kumar","Blown -Film Unit -4"],
["H720","Vinay Singh Chauchan","Blown -Film Unit -4"]
];

try {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB\n');

  const employeeSchema = new mongoose.Schema({
    employeeId: String,
    name: String,
    email: String,
    department: String,
    designation: String,
    password: String,
    role: String,
    active: Boolean,
  }, { strict: false });

  const Employee = mongoose.model('FixEmployee', employeeSchema, 'employees');

  let updated = 0;
  let created = 0;
  let errors = [];

  const defaultPassword = await bcrypt.hash('Prem@2025', 10);

  for (const [eid, empName, rawDept] of employeeData) {
    try {
      const name = empName.trim().replace(/\s+/g, ' ');
      const department = normalizeDepartmentName(rawDept.trim().replace(/\s+/g, ' '));
      const existing = await Employee.findOne({ employeeId: eid }).lean();

      if (existing) {
        await Employee.updateOne(
          { employeeId: eid },
          { $set: { name, department } }
        );
        updated++;
      } else {
        await Employee.create({
          employeeId: eid,
          name,
          department,
          designation: 'Employee',
          password: defaultPassword,
          role: 'employee',
          active: true,
        });
        created++;
      }
    } catch (err) {
      errors.push(`${eid}: ${err.message}`);
    }
  }

  console.log(`Fixed: ${updated} updated, ${created} created`);
  if (errors.length) {
    console.log(`\nErrors (${errors.length}):`);
    errors.forEach(e => console.log(`  ${e}`));
  }

  await mongoose.disconnect();
  console.log('\nDone.');
} catch (err) {
  console.error('Fatal:', err.message);
  process.exit(1);
}
