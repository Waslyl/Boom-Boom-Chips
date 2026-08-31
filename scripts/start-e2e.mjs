/**
 * Boots the production server for the end-to-end suite: real bundle, real
 * socket, one origin. The grace period is shortened so a disconnect test does
 * not have to sit through a full minute.
 */
process.env.PORT = '8099';
process.env.BBC_HOST = '127.0.0.1';
process.env.BBC_CLIENT_DIR = 'client/dist';
process.env.BBC_SESSION_SECRET = 'e2e-secret-not-for-production';
process.env.BBC_DISCONNECT_GRACE_MS = '6000';

await import('../server/dist/index.js');
