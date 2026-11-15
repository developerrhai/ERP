// Seeds Document Management demo data through the API: a folder tree, folder permissions (ACL), documents with uploaded files,
// extra versions (check-out and check-in), tags, a legal hold and a share link.
// Re-runnable: natural keys are folder name under its parent and document title.
import * as L from './opslib.mjs';
const { call, ensure, step, list } = L;
await L.login();
const talwade = L.plant('Talwade');

const upload = async (filename, text) => {
  const r = await call('POST', '/files', { filename, mimeType: 'text/plain', dataBase64: Buffer.from(text, 'utf8').toString('base64') });
  if (!r.ok) { console.log('warn upload', filename, r.status, r.err); return null; }
  return r.data.id;
};

await L.withApprovalsOff(['dms-'], async () => {
  // ---- folders: [name, parent name | null, confidentiality, retention years]
  const folders = L.rowsOf((await call('GET', '/dms/folders')).data);
  const defs = [
    ['Quality Management', null, 'INTERNAL', 8], ['Inspection Reports', 'Quality Management', 'INTERNAL', 8], ['Customer Complaints and 8D', 'Quality Management', 'RESTRICTED', 10],
    ['Statutory and Compliance', null, 'RESTRICTED', 10], ['GST and Tax Returns', 'Statutory and Compliance', 'RESTRICTED', 8], ['Factory Licences and Consents', 'Statutory and Compliance', 'INTERNAL', 10],
    ['Purchase and Vendors', null, 'INTERNAL', 8], ['Vendor Agreements', 'Purchase and Vendors', 'RESTRICTED', 10],
    ['Engineering Drawings', null, 'RESTRICTED', 15], ['Pump Assembly Drawings', 'Engineering Drawings', 'RESTRICTED', 15],
    ['HR Policies', null, 'INTERNAL', 5], ['Maintenance Manuals', null, 'INTERNAL', 10],
  ];
  const newFolders = new Set();
  for (const [name, parent, confidentiality, retentionYears] of defs) {
    const cur = L.rowsOf(folders);
    if (cur.some((f) => f.name === name)) { L.stats.skipped++; continue; }
    const p = parent ? cur.find((f) => f.name === parent) : null;
    if (parent && !p) continue;
    const f = await ensure(`folder ${name}`, null, () => false, '/dms/folders', { name, ...(p ? { parentId: p.id } : {}), unitId: talwade.id, confidentiality, retentionYears, retentionTrigger: 'CREATED', inheritAcl: true }, []);
    if (f) { folders.push(f); newFolders.add(name); }
  }
  const F = Object.fromEntries(L.rowsOf((await call('GET', '/dms/folders')).data).map((f) => [f.name, f]));

  // ---- folder permissions
  const roles = await list('/roles'), depts = await list('/departments');
  const role = (c) => roles.find((r) => r.code === c)?.id, dept = (n) => depts.find((d) => d.name === n)?.id;
  for (const [fname, ptype, pid, perms] of [
    ['Quality Management', 'DEPARTMENT', dept('Quality'), { canView: true, canUpload: true, canEdit: true, canDownload: true, canShare: false }],
    ['Customer Complaints and 8D', 'DEPARTMENT', dept('Sales'), { canView: true, canDownload: true }],
    ['Statutory and Compliance', 'DEPARTMENT', dept('Finance'), { canView: true, canUpload: true, canEdit: true, canDownload: true }],
    ['Vendor Agreements', 'DEPARTMENT', dept('Purchase'), { canView: true, canUpload: true, canEdit: true, canDownload: true, canShare: true }],
    ['Engineering Drawings', 'DEPARTMENT', dept('Production'), { canView: true, canDownload: true }],
    ['HR Policies', 'ROLE', role('EMPLOYEE'), { canView: true, canDownload: true }],
    ['Maintenance Manuals', 'DEPARTMENT', dept('Maintenance'), { canView: true, canUpload: true, canEdit: true, canDownload: true }],
  ]) {
    if (!F[fname] || !pid) continue;
    if (!newFolders.has(fname)) { L.stats.skipped++; continue; } // permissions are only granted when the folder is created by this run
    const r = await call('POST', `/dms/folders/${F[fname].id}/acl`, { principalType: ptype, principalId: pid, ...perms });
    if (r.ok) { L.stats.created++; console.log(`ok   acl ${fname}`); } else console.log('warn acl', fname, r.status, r.err, JSON.stringify(r.details));
  }

  // ---- documents: [title, folder, description, tags, text, confidentiality, extra versions]
  const docs = L.rowsOf((await call('GET', '/dms/search?q=')).data);
  const have = new Set(docs.map((d) => d.title));
  const docDefs = [
    ['Incoming Inspection Procedure QP-07', 'Inspection Reports', 'Procedure for sampling and acceptance of incoming raw material.', ['SOP', 'QUALITY'], 'QP-07 Incoming inspection. Sampling as per AQL 1.5. Record readings on sheet IQC. Reject lots go to the hold area and NCR is raised.', 'INTERNAL', 2],
    ['Calibration Schedule 2026-27', 'Inspection Reports', 'Yearly gauge calibration plan with due dates.', ['CALIBRATION', 'QUALITY'], 'Gauge calibration schedule FY 2026-27. Vernier, micrometer, dial gauge: yearly. Pressure gauge: six monthly.', 'INTERNAL', 1],
    ['8D Report, Pump Casing Bore Oversize', 'Customer Complaints and 8D', 'Closed 8D with root cause and corrective action.', ['8D', 'CAPA'], '8D problem solving. D2 problem: bore oversize 0.03 mm. D4 root cause: tool life not tracked. D5: insert change every 300 pieces.', 'RESTRICTED', 1],
    ['GSTR-3B Working Paper, October 2026', 'GST and Tax Returns', 'Reconciliation of books with GSTR-3B for October.', ['GST', 'RETURN'], 'GSTR-3B October 2026. Output tax and input tax credit reconciliation. ITC as per GSTR-2B matched.', 'RESTRICTED', 0],
    ['Factory Licence Renewal Application', 'Factory Licences and Consents', 'Application for renewal of factory licence under the Factories Act.', ['LICENCE', 'STATUTORY'], 'Application for renewal of factory licence for Talwade plant. Valid till 31 December 2026. Fee paid by challan.', 'INTERNAL', 0],
    ['Consent to Operate, MPCB', 'Factory Licences and Consents', 'Maharashtra Pollution Control Board consent to operate.', ['LICENCE', 'ENVIRONMENT'], 'MPCB consent to operate for the powder coating unit. Valid till 30 June 2028. Conditions: stack monitoring quarterly.', 'INTERNAL', 0],
    ['Master Purchase Agreement, Alfa Metals', 'Vendor Agreements', 'Rate contract for MS plates and sheets.', ['CONTRACT', 'VENDOR'], 'Master purchase agreement with Alfa Metals Pvt Ltd. Validity 1 April 2026 to 31 March 2027. Payment 45 days. Rates fixed quarterly.', 'RESTRICTED', 1],
    ['Transport Service Agreement, Shree Sai Roadlines', 'Vendor Agreements', 'Freight contract for Pune and Nashik lanes.', ['CONTRACT', 'LOGISTICS'], 'Transport service agreement. Lanes Talwade to Pune and Nashik. Per trip rates. GTA, reverse charge applies.', 'RESTRICTED', 0],
    ['Pump Assembly 1HP, General Arrangement Drawing', 'Pump Assembly Drawings', 'GA drawing revision C.', ['DRAWING', 'PUMP'], 'Drawing PA-1HP-GA rev C. Overall length 412 mm. Shaft diameter 20 mm. Material CI FG 260.', 'RESTRICTED', 2],
    ['Pump Casing Machining Drawing', 'Pump Assembly Drawings', 'Casing bore details and tolerances.', ['DRAWING', 'PUMP'], 'Drawing PA-1HP-CS rev B. Bore 35 H7. Surface finish Ra 1.6 on bore. Face run-out 0.05 mm.', 'RESTRICTED', 0],
    ['Leave and Attendance Policy 2026', 'HR Policies', 'Company leave rules for all employees.', ['POLICY', 'HR'], 'Leave policy. Casual leave 8 days, earned leave 15 days, sick leave 8 days. Late mark rule: three late marks equal half day.', 'INTERNAL', 1],
    ['CNC Machining Centre Maintenance Manual', 'Maintenance Manuals', 'OEM manual extract: lubrication and coolant care.', ['MANUAL', 'MAINTENANCE'], 'VMC-850 manual extract. Way lube every shift check. Coolant concentration 8 percent. Spindle warm-up 10 minutes.', 'INTERNAL', 1],
    ['Air Compressor Service Checklist', 'Maintenance Manuals', 'Monthly service checklist for the screw compressor.', ['MANUAL', 'MAINTENANCE'], 'Compressor monthly service: oil level, air filter, discharge pressure 6.5 to 8 bar, belt tension.', 'INTERNAL', 0],
  ];
  const created = {};
  for (const [title, folder, description, tagCodes, text, confidentiality, extra] of docDefs) {
    if (have.has(title)) { L.stats.skipped++; continue; }
    const fileId = await upload(title.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40) + '.txt', `${title}\n\n${text}\n`);
    if (!fileId || !F[folder]) continue;
    const d = await ensure(`document ${title}`, null, () => false, '/dms/documents', { folderId: F[folder].id, title, description, confidentiality, storedFileId: fileId, rawTextContent: text, tagCodes, effectiveDate: '2026-11-01' }, []);
    if (!d) continue;
    created[title] = { d, extra, text };
  }
  // extra versions: check out, check in with a new file and a change note
  for (const [title, { d, extra, text }] of Object.entries(created)) {
    for (let v = 1; v <= extra; v++) {
      const out = await call('POST', `/dms/documents/${d.id}/checkout`, {});
      if (!out.ok) { console.log('warn checkout', title, out.status, out.err); break; }
      const fid = await upload(`${title.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 36)}_v${v + 1}.txt`, `${title}\nRevision ${v + 1}\n\n${text}\nRevised on 2026-11-${10 + v}.\n`);
      await step('checkin', 'POST', `/dms/documents/${d.id}/checkin`, { storedFileId: fid, changeNote: ['Updated after the internal audit', 'Reviewed, formatting and dates corrected'][v - 1] ?? 'Minor update', extractedText: `${text} Revision ${v + 1}.` });
    }
  }
  // legal hold on the agreement and a share link on a policy
  const c = created['Master Purchase Agreement, Alfa Metals'];
  if (c) await step('legal hold', 'POST', `/dms/documents/${c.d.id}/hold`, { legalHold: true, reason: 'Open price dispute with the supplier, keep all versions' });
  const pol = created['Leave and Attendance Policy 2026'];
  if (pol) await step('share link', 'POST', `/dms/documents/${pol.d.id}/share`, { expiresHours: 72, maxDownloads: 20 });
});
L.summary('dms total');
