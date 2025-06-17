import * as net from "net";
import * as tls from "tls";
import { SocketBuffer } from "./socketbuffer.js";
import { AuthenticationProvider } from "./auth.js";
import { XSessionManager } from "./xsessionmanager.js";
import { XVncConnection } from "./xvncconnection.js";
import pino, { Logger } from "pino";

export class RFBServer {
    private server: net.Server;
    private tlsServer: tls.Server;
    private authProvider: AuthenticationProvider;
    private xsessManager: XSessionManager;
    private logger: Logger = pino({name: 'RFBServer'});

    constructor(cert: Buffer, key: Buffer, auth: AuthenticationProvider) {
        this.server = new net.Server();
        this.tlsServer = new tls.Server({
            cert,
            key
        });
        this.authProvider = auth;
        this.xsessManager = new XSessionManager();
        this.server.on('connection', (socket) => this.handleConnection(socket));
        this.tlsServer.on('secureConnection', (socket) => this.handleTlsConnection(socket));
    }

    listen(host: string, port: number) {
        this.server.listen({
            host,
            port
        });
        this.logger.info('Listening for RFB connections on %s:%d', host, port);
    }

    private async handleConnection(socket: net.Socket) {
        let logger = this.logger.child({client: `${socket.remoteAddress}:${socket.remotePort}`, state: "HandshakePreTls"});
        logger.info('New connection')
        // create socket buffer
        let buffer = new SocketBuffer(false);
        let handler = (data: Buffer) => buffer.pushData(data);
        socket.on('data', handler);
        socket.on('end', () => buffer.end());
        // Write RFB version
        socket.write('RFB 003.008\n');
        // Read client version
        let rfbVersion = (await buffer.readNBytesOffset(12)).toString('ascii');
        if (rfbVersion != 'RFB 003.008\n' && rfbVersion != 'RFB 003.007\n' && rfbVersion != 'RFB 003.003\n') {
            socket.end();
            logger.error('Invalid RFB version %s', rfbVersion);
            return;
        }
        (socket as any).rfbVersion = rfbVersion;
        // VeNCrypt security type
        if (rfbVersion == 'RFB 003.003\n') {
            let buf = Buffer.alloc(4);
            buf.writeUint32BE(19, 0);
            socket.write(buf);
        } else {
            socket.write(Buffer.from([1, 19]));
            // Read security type from client
            let clientType = await buffer.readUInt8();
            if (clientType != 19) {
                socket.end();
                logger.error('Invalid security type %s', clientType);
                return;
            }
        }
        // Write VeNCrypt version
        socket.write(Buffer.from([0, 2]));
        // Read client version
        var cvcVerMajor = await buffer.readUInt8();
        var cvcVerMinor = await buffer.readUInt8();
        if (cvcVerMajor != 0 || cvcVerMinor != 2) {
            socket.write(Buffer.from([1]));
            socket.end();
            logger.error('Invalid VeNCrypt version %d.%d', cvcVerMajor, cvcVerMinor);
            return;
        }
        // Send ack
        socket.write(Buffer.from([0]));
        // Send VeNCrypt subtype (X509Plain)
        let buf = Buffer.alloc(5);
        buf[0] = 1;
        buf.writeUint32BE(262, 1);
        socket.write(buf);
        // Read selected subtype
        let clientSubtype = await buffer.readUInt32BE();
        if (clientSubtype != 262) {
            socket.write(Buffer.from([0]));
            socket.end();
            logger.error('Invalid VeNCrypt subtype %d', clientSubtype);
            return;
        }
        // End socket buffer
        socket.off('data', handler);
        buffer.end();
        // Start listen for TLS handshake
        this.tlsServer.emit('connection', socket);
        // Ack
        socket.write(Buffer.from([1]));
    }

    private async handleTlsConnection(socket: tls.TLSSocket) {
        let logger = this.logger.child({client: `${socket.remoteAddress}:${socket.remotePort}`, state: "HandshakeTlsComplete"});
        logger.info('TLS handshake complete');
        let rfbVersion = (socket as any)._parent.rfbVersion as string;
        // Create socket buffer
        let buffer = new SocketBuffer(false);
        let handler = (data: Buffer) => buffer.pushData(data);
        socket.on('data', handler);
        socket.on('end', () => buffer.end());
        socket.on('error', () => true);
        // Read username and password length
        let usernameLength = await buffer.readUInt32BE();
        let passwordLength = await buffer.readUInt32BE();
        // Read credentials
        let username = (await buffer.readNBytesOffset(usernameLength)).toString('utf8');
        let password = (await buffer.readNBytesOffset(passwordLength)).toString('utf8');
        logger.info('Authenticating as %s', username);
        // Authenticate
        let result = await this.authProvider.authenticate(username, password);
        if (result !== true) {
            let buf = Buffer.alloc(4);
            buf.writeUint32BE(1, 0);
            socket.write(buf);
            if (rfbVersion == 'RFB 003.008\n') {
                let buf = Buffer.alloc(4 + result.length);
                buf.writeUint32BE(result.length, 0);
                buf.write(result, 4, 'utf8');
                socket.write(buf);
            }
            socket.end();
            logger.error('Authentication failure');
            return;
        }
        logger.info('Authentication success');
        // Close buffer
        socket.off('data', handler);
        buffer.end();
        // Get session
        let rfbPath = await this.xsessManager.getOrStartSession(username);
        // Connect to Xvnc server
        let xvnc = new XVncConnection(rfbPath);
        xvnc.on('end', () => {
            if (!socket.destroyed) {
                logger.info('Closing connection (X server died)');
                socket.end();
            }
        });
        socket.on('end', () => {
            if (!xvnc.destroyed) {
                logger.info('Client closed connection');
                xvnc.end();
            }
        });
        xvnc.on('ready', () => {
            xvnc.on('data', (data) => socket.write(data));
            socket.on('data', (data) => xvnc.write(data));
            // SecurityResult success
            let buf = Buffer.alloc(4);
            buf.writeUint32BE(0, 0);
            socket.write(buf);
        });
    }
 }