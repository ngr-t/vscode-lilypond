#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('-o');
  if (outputIndex < 0 || outputIndex === args.length - 1) {
    process.stderr.write('missing -o output path\n');
    process.exit(1);
    return;
  }

  const outputBase = args[outputIndex + 1];
  const inputPath = args[args.length - 1];
  fs.mkdirSync(path.dirname(outputBase), { recursive: true });

  const encodedInput = encodeURIComponent(inputPath);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="100">',
    '<rect x="0" y="0" width="200" height="100" fill="#ffffff"/>',
    `<a xlink:href="textedit://${encodedInput}:3:1:4">`,
    '<rect x="20" y="20" width="160" height="60" fill="#334455"/>',
    '</a>',
    '</svg>'
  ].join('');

  fs.writeFileSync(`${outputBase}.svg`, svg, 'utf8');
  process.exit(0);
}

main();
