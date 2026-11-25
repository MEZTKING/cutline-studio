#!/usr/bin/env node
'use strict';
// Development launcher. Packaged builds use "Cutline Studio.exe --render ...".
const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');
const root = path.resolve(__dirname, '..');
const child = spawn(electron, [root, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
