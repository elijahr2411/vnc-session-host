import EventEmitter from 'events';
import * as net from 'net';
import { SocketBuffer } from './socketbuffer.js';
import pino, { Logger } from 'pino';

export class XVncConnection extends EventEmitter {
    private static rootLogger: Logger = pino({name: 'XVncConnection'});
    private socket: net.Socket;
    private isReady: boolean = false;
    private logger: Logger;
    destroyed: boolean = false;

    constructor(path: string) {
        super();
        this.logger = XVncConnection.rootLogger.child({path});
        this.socket = net.connect({
            path
        });
        this.socket.on('connect', () => this.handleOpen());
        this.socket.on('end', () => {
            this.destroyed = true;
            this.emit('end');
        });
    }

    write(data: Buffer) {
        if (!this.isReady) {
            return;
        }
        this.socket.write(data);
    }

    end() {
        this.socket.end();
    }

    private async handleOpen() {
        // create socket buffer
        let buffer = new SocketBuffer(false);
        let handler = (data: Buffer) => buffer.pushData(data);
        this.socket.on('data', handler);
        this.socket.on('end', () => buffer.end());
        // Read RFB version
        let rfbVersion = (await buffer.readNBytesOffset(12)).toString('ascii');
        if (rfbVersion != 'RFB 003.003\n' && rfbVersion != 'RFB 003.007\n' && rfbVersion != 'RFB 003.008\n') {
            this.socket.end();
            this.logger.error('Invalid RFB version %s', rfbVersion);
            return;
        }
        this.socket.write(rfbVersion);
        // Read security types
        if (rfbVersion == 'RFB 003.003\n') {
            let securityType = await buffer.readUInt32BE();
            if (securityType != 1) {
                this.socket.end();
                this.logger.error('Invalid security type %s', securityType);
                return;
            }
        } else {
            let typeCount = await buffer.readUInt8();
            let securityTypes = await buffer.readNBytesOffset(typeCount);
            if (!securityTypes.includes(1)) {
                this.socket.end();
                this.logger.error({securityTypes}, 'Invalid security types');
                return;
            }
            this.socket.write(Buffer.from([1]));
        }
        // Security result
        if (rfbVersion == 'RFB 003.008\n') {
            let securityResult = await buffer.readUInt32BE();
            if (securityResult != 0) {
                let reasonLength = await buffer.readUInt32BE();
                let reason = (await buffer.readNBytesOffset(reasonLength)).toString('utf8');
                this.socket.end();
                this.logger.error({securityResult, reason}, 'Bad security result');
                return;
            }
        }
        // Ready
        this.socket.off('data', handler);
        buffer.end();
        this.isReady = true;
        this.emit('ready');
        this.socket.on('data', (data) => this.emit('data', data));
    }
}