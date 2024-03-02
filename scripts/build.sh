#!/bin/bash

# build esm
npx tsc -p tsconfig.json

# build cjs
npx tsc -p tsconfig.cjs.json

# generate package.json in dist
cat >dist/cjs/package.json <<!EOF
{
  "type": "commonjs"
}
!EOF
cat >dist/esm/package.json <<!EOF
{
  "type": "module"
}
!EOF
