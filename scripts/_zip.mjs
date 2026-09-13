// _zip.mjs - Write a zip archive in plain Node: no python, no tar, no
// dependency, and the same behaviour on every system.
//
// build-snapshot.mjs used to hand the finished folder to a Python one-liner.
// On many Windows machines `python` is only the Microsoft Store stub that
// prints "Python was not found", so the snapshot failed at its very last
// step, after everything else had worked (reported on 3.1.5). Node has zlib;
// the container format is a few headers.
//
// Format: for each file a local header, the deflated bytes, then a data
// descriptor with the CRC and sizes (general purpose flag bit 3), so that a
// file of any size streams through without being held in memory; then the
// central directory and its end record. Names are UTF-8 (flag bit 11).
// Entries are sorted, so the same tree gives the same archive. Directories
// are not written as entries: every unzip tool recreates them from the
// paths. No zip64: more than 65 535 files or 4 GiB in one file is refused
// with a clear message rather than a corrupt archive.

import { createReadStream, readdirSync, statSync, openSync, writeSync, closeSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createDeflateRaw } from "node:zlib";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(buf, previous = 0) {
  let c = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function listFiles(dir, acc = []) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, acc);
    else if (e.isFile()) acc.push(p);
  }
  return acc;
}

const MAX_ENTRIES = 65535;
const MAX_BYTES = 0xffffffff;

/**
 * Zips `srcDir` into `zipPath`. Entry names are relative to `base`, by
 * default the parent of `srcDir`, so the archive opens on the folder itself.
 * @returns {Promise<{ entries: number, bytes: number }>}
 */
export async function zipDirectory(srcDir, zipPath, { base = dirname(srcDir), level = 6 } = {}) {
  const files = listFiles(srcDir);
  if (files.length > MAX_ENTRIES) {
    throw new Error(`zip: ${files.length} files, this writer stops at ${MAX_ENTRIES} (no zip64)`);
  }
  const fd = openSync(zipPath, "w");
  let offset = 0;
  const write = (buf) => {
    writeSync(fd, buf);
    offset += buf.length;
  };
  const central = [];
  try {
    for (const file of files) {
      const st = statSync(file);
      if (st.size > MAX_BYTES) {
        throw new Error(`zip: ${relative(base, file)} is larger than 4 GiB, this writer has no zip64`);
      }
      const name = Buffer.from(relative(base, file).split("\\").join("/"), "utf8");
      const { time, date } = dosDateTime(st.mtime);
      const headerOffset = offset;

      // Local header: sizes and CRC unknown yet (bit 3), UTF-8 name (bit 11).
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0808, 6);
      local.writeUInt16LE(8, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(0, 14);
      local.writeUInt32LE(0, 18);
      local.writeUInt32LE(0, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      write(local);
      write(name);

      // Stream: file -> crc/size counter -> deflate -> compressed counter -> fd.
      let crc = 0;
      let size = 0;
      let csize = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          crc = crc32(chunk, crc);
          size += chunk.length;
          cb(null, chunk);
        },
      });
      const sink = new Transform({
        transform(chunk, _enc, cb) {
          csize += chunk.length;
          write(chunk);
          cb();
        },
      });
      await pipeline(createReadStream(file), counter, createDeflateRaw({ level }), sink);
      if (csize > MAX_BYTES) throw new Error(`zip: ${relative(base, file)} compresses to more than 4 GiB, no zip64`);

      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(csize, 8);
      descriptor.writeUInt32LE(size, 12);
      write(descriptor);

      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(0x0808, 8);
      cd.writeUInt16LE(8, 10);
      cd.writeUInt16LE(time, 12);
      cd.writeUInt16LE(date, 14);
      cd.writeUInt32LE(crc, 16);
      cd.writeUInt32LE(csize, 20);
      cd.writeUInt32LE(size, 24);
      cd.writeUInt16LE(name.length, 28);
      cd.writeUInt16LE(0, 30);
      cd.writeUInt16LE(0, 32);
      cd.writeUInt16LE(0, 34);
      cd.writeUInt16LE(0, 36);
      cd.writeUInt32LE(0, 38);
      cd.writeUInt32LE(headerOffset, 42);
      central.push(cd, name);
    }
    const cdStart = offset;
    for (const buf of central) write(buf);
    const cdSize = offset - cdStart;
    if (cdStart > MAX_BYTES || cdSize > MAX_BYTES) throw new Error("zip: archive larger than 4 GiB, no zip64");
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    write(eocd);
  } finally {
    closeSync(fd);
  }
  return { entries: files.length, bytes: offset };
}
