import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '.env') });

import connectDB from './config/db.js';

const run = async () => {
  await connectDB();
  const db = mongoose.connection.db;

  // Get all leaves and inspect their fields
  const leaves = await db.collection('leaves').find({}).toArray();
  
  // Collect all unique field names across all documents
  const allFields = new Set();
  for (const l of leaves) {
    for (const key of Object.keys(l)) {
      allFields.add(key);
    }
  }
  console.log('All fields present in leaves collection:', [...allFields].sort());

  // Show each document with all its fields
  for (const l of leaves) {
    console.log('\n=== Leave document ===');
    for (const key of Object.keys(l).sort()) {
      let val = l[key];
      if (key === '_id' || key === 'employee' || key === 'approver' || key === 'actionedBy') {
        val = String(val);
      } else if (val instanceof Date) {
        val = val.toISOString().slice(0, 10);
      } else if (typeof val === 'object' && val !== null) {
        val = JSON.stringify(val);
      }
      console.log(`  ${key}: ${val}`);
    }
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(err => { console.error(err); process.exit(1); });
