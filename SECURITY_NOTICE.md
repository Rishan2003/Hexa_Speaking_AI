# Security notice

The uploaded archive contained live-looking server credentials in `.env.local`. They were removed from this repaired distributable. Rotate the Gemini API key and Firebase service-account key before using the project again, then create a fresh local `.env.local` from `.env.local.example`. Never commit or share `.env.local`.
