{
  'targets':
  [
    {
      'target_name': 'libmincypt',
      'type': 'static_library',
      'include_dirs':
      [
        './include'
      ],
      'sources':
      [
        'rsa.c',
        'sha.c',
        'sha256.c',
        'dsa_sig.c',
        'p256.c',
        'p256_ec.c',
        'p256_ecdsa.c'
      ]
    }
  ]
}