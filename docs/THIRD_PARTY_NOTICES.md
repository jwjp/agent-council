# Third-party acknowledgments

Pairing QR images are generated with node-qrcode, Copyright (c) 2012 Ryan Day, MIT License. See [QRCODE_LICENSE.txt](QRCODE_LICENSE.txt). Keep this notice with distributed copies containing the QR generator.

Provider quota endpoint and response mappings were informed by Orca (stablyai/orca), commits 2ee2fd7ca39c98d0f8338beef54ecc3325593713 and 0fe7a0beed4d7fd914c3ea9408eccf419bfe22d8. Copyright (c) 2026 Lovecast Inc. MIT License: see ORCA_LICENSE.txt.

The implementation reads existing local sign-ins and sends credentials only to the matching provider's fixed HTTPS endpoint. It does not upload credentials to Agent Council or analytics, and never returns them to the frontend.
