'use strict';
// Writes small, valid synthetic DICOM CT series (Part 10, explicit VR little endian) for the tests.
// The data is generated, never a patient's.
const fs = require('fs');
const path = require('path');

function el(group, elem, vr, value) {
  let body;
  if (Buffer.isBuffer(value)) body = value;
  else if (vr === 'US') { body = Buffer.alloc(2); body.writeUInt16LE(value); }
  else if (vr === 'UL') { body = Buffer.alloc(4); body.writeUInt32LE(value); }
  else { body = Buffer.from(String(value), 'latin1'); }
  if (body.length % 2) body = Buffer.concat([body, Buffer.from(vr === 'UI' || vr === 'OB' || vr === 'OW' ? [0] : [0x20])]);
  const long = ['OB', 'OW', 'OF', 'SQ', 'UT', 'UN'].includes(vr);
  const h = Buffer.alloc(long ? 12 : 8);
  h.writeUInt16LE(group, 0); h.writeUInt16LE(elem, 2); h.write(vr, 4, 'latin1');
  if (long) h.writeUInt32LE(body.length, 8); else h.writeUInt16LE(body.length, 6);
  return Buffer.concat([h, body]);
}

function ctSlice({ studyUid, seriesUid, sopUid, instance, z, rows = 64, cols = 64, desc = 'Test axial', patient = 'TEST^PATIENT' }) {
  const px = Buffer.alloc(rows * cols * 2);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const dx = x - cols / 2, dy = y - rows / 2, r = Math.sqrt(dx * dx + dy * dy);
    const hu = r < cols * 0.4 ? (r < cols * 0.15 + instance ? 300 : 40) : -1000;
    px.writeInt16LE(hu, (y * cols + x) * 2);
  }
  const meta = Buffer.concat([
    el(0x0002, 0x0001, 'OB', Buffer.from([0, 1])),
    el(0x0002, 0x0002, 'UI', '1.2.840.10008.5.1.4.1.1.2'),
    el(0x0002, 0x0003, 'UI', sopUid),
    el(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1'),
    el(0x0002, 0x0012, 'UI', '1.2.826.0.1.3680043.10.1'),
  ]);
  const ds = Buffer.concat([
    el(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.2'),
    el(0x0008, 0x0018, 'UI', sopUid),
    el(0x0008, 0x0020, 'DA', '20260101'),
    el(0x0008, 0x0060, 'CS', 'CT'),
    el(0x0008, 0x1030, 'LO', 'Synthetic test study'),
    el(0x0008, 0x103e, 'LO', desc),
    el(0x0010, 0x0010, 'PN', patient),
    el(0x0010, 0x0020, 'LO', 'TEST-0001'),
    el(0x0018, 0x0050, 'DS', '2.5'),
    el(0x0020, 0x000d, 'UI', studyUid),
    el(0x0020, 0x000e, 'UI', seriesUid),
    el(0x0020, 0x0013, 'IS', String(instance)),
    el(0x0020, 0x0032, 'DS', '-80\\-80\\' + z.toFixed(1)),
    el(0x0020, 0x0037, 'DS', '1\\0\\0\\0\\1\\0'),
    el(0x0028, 0x0002, 'US', 1),
    el(0x0028, 0x0004, 'CS', 'MONOCHROME2'),
    el(0x0028, 0x0010, 'US', rows),
    el(0x0028, 0x0011, 'US', cols),
    el(0x0028, 0x0030, 'DS', '2.5\\2.5'),
    el(0x0028, 0x0100, 'US', 16),
    el(0x0028, 0x0101, 'US', 16),
    el(0x0028, 0x0102, 'US', 15),
    el(0x0028, 0x0103, 'US', 1),
    el(0x0028, 0x1050, 'DS', '40'),
    el(0x0028, 0x1051, 'DS', '400'),
    el(0x0028, 0x1052, 'DS', '0'),
    el(0x0028, 0x1053, 'DS', '1'),
    el(0x7fe0, 0x0010, 'OW', px),
  ]);
  const groupLen = el(0x0002, 0x0000, 'UL', meta.length);
  return Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), groupLen, meta, ds]);
}

// Writes `count` slices into dir (in sub folders, like a CD), plus a few files that must be ignored.
function writeSeries(dir, { count = 12, seriesNo = 1, desc, ext = '' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const root = '1.2.826.0.1.3680043.10.99.' + seriesNo;
  const studyUid = '1.2.826.0.1.3680043.10.99.1000';
  const files = [];
  for (let i = 1; i <= count; i++) {
    const sub = path.join(dir, 'SE' + seriesNo, 'IM' + String(Math.floor((i - 1) / 5)));
    fs.mkdirSync(sub, { recursive: true });
    const f = path.join(sub, 'I' + String(i).padStart(4, '0') + ext);
    fs.writeFileSync(f, ctSlice({ studyUid, seriesUid: root + '.1', sopUid: root + '.1.' + i, instance: i, z: i * 2.5, desc: desc || 'Test axial ' + seriesNo }));
    files.push(f);
  }
  fs.writeFileSync(path.join(dir, 'README.TXT'), 'not an image');
  fs.writeFileSync(path.join(dir, 'AUTORUN.INF'), '[autorun]');
  return files;
}

module.exports = { ctSlice, writeSeries };
