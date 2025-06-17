import pino from "pino";
import { RFBServer } from "./rfbserver.js";
import * as fs from 'fs/promises';
import { AuthenticationProvider } from "./auth.js";

let logger = pino();

if (process.getuid?.() !== 0) {
    logger.error('This server requires root priviliges');
    process.exit(1);
}

try {
    await fs.access('/usr/bin/Xvnc', fs.constants.X_OK);
} catch {
    logger.error('This server requires Xvnc to be available. Please make sure tigervnc is installed.');
    process.exit(1);
}

const HOST = process.env.RFB_HOST || '0.0.0.0';
let PORT = NaN;
if (process.env.RFB_PORT) {
    PORT = parseInt(process.env.RFB_PORT);
}
if (isNaN(PORT)) {
    PORT = 5900;
}
const CERTPATH = process.env.RFB_CERT;
const KEYPATH = process.env.RFB_KEY;

if (!CERTPATH || !KEYPATH) {
    logger.error('RFB_CERT and RFB_KEY must be set to a valid x509 certificate and key.');
    process.exit(1);
}

const PAMSERVICE = process.env.RFB_PAM_SERVICE || 'vnc';

let cert = await fs.readFile(CERTPATH);
let key = await fs.readFile(KEYPATH);

let auth = new AuthenticationProvider(PAMSERVICE);

let server = new RFBServer(cert, key, auth);
server.listen(HOST, PORT);