#include <stdio.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <unistd.h>

#include <node.h>
#include <v8.h>
#include <nan.h>

#define RSA_verify RSA_verify_mincrypt
#include "rsa.h"
#undef RSA_verify

#include <openssl/evp.h>
#include <openssl/objects.h>
#include <openssl/pem.h>
#include <openssl/rsa.h>
#include <openssl/sha.h>

#include "sign.h"
#include <errno.h>
#include <string.h>
#define MAX_PAYLOAD 4096

void Sign(const Nan::FunctionCallbackInfo<v8::Value>& args) {

  if (args.Length() < 2) {
    Nan::ThrowTypeError("Wrong number of arguments");
    return;
  }

  FILE *fd;
  unsigned int len;
  const char* key_path;
  const unsigned char* token;

  key_path = (const char*)node::Buffer::Data(args[0]);
  token = (unsigned char*)node::Buffer::Data(args[1]);

  unsigned char sig[MAX_PAYLOAD];

  RSA *rsa = RSA_new();
  fd = fopen(key_path, "r");
  if (!fd) {
    Nan::ThrowTypeError("fopen() failed");
    return;
  }
  if (!PEM_read_RSAPrivateKey(fd, &rsa, NULL, NULL)) {
    fclose(fd);
    RSA_free(rsa);
    Nan::ThrowTypeError("couldn't read private key");
    return;
  }
  if (!RSA_sign(NID_sha1, token, node::Buffer::Length(args[1]), sig, &len, rsa)) {
    Nan::ThrowTypeError("failed to sign token");
  }
  args.GetReturnValue().Set(Nan::CopyBuffer(reinterpret_cast<const char*>(sig), len).ToLocalChecked());
}

void Init(v8::Local<v8::Object> exports) {
  exports->Set(Nan::New("sign").ToLocalChecked(),
              Nan::New<v8::FunctionTemplate>(Sign)->GetFunction());
}

NODE_MODULE(binding, Init)