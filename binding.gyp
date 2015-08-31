{
  'targets':
  [
    {
      'target_name': 'binding',
      'sources': [ 'binding/sign.cc' ],
      'include_dirs': [ './deps/libmincrypt/include', "<!(node -e \"require('nan')\")" ],
    }
  ]
}