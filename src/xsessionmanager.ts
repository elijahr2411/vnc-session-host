import { execa, Subprocess } from 'execa';

type VirtualXSession = {
    xvnc: Subprocess;
    xsession: Subprocess;
    display: number;
    rfbSocket: string;
}

export class XSessionManager {
    private nextDisplay: number;
    private sessions: Map<string, VirtualXSession>;

    constructor() {
        this.nextDisplay = 100;
        this.sessions = new Map();
    }

    getOrStartSession(username: string): Promise<string> {
        return new Promise((res, rej) => {
            if (this.sessions.has(username)) {
                res(this.sessions.get(username)!.rfbSocket);
            } else {
                let display = this.nextDisplay++;
                let rfbSocket = `/tmp/rfb-${username}.sock`;
                // Start VNC server
                let xvnc = execa('su', ['-l', username, '-c', `Xvnc -SecurityTypes None -RfbPort -1 -RfbUnixPath '${rfbSocket}' :${display}`], { stdout: 'pipe', stderr: 'pipe' });
                xvnc.on('spawn', () => {
                    // Start X session
                    let xsession = execa('su', ['-l', username, '-c', `cd "$HOME"; export DISPLAY=:${display}; if [[ -f "$HOME/.xinitrc" ]]; then source "$HOME/.xinitrc"; else source "/etc/X11/xinit/xinitrc"; fi`]);
                    xsession.on('exit', () => xvnc.kill('SIGTERM'));  
                    xvnc.stderr.on('data', (data) => {
                        if (data.toString('utf8').includes('Listening for VNC connections')) {
                            this.sessions.set(username, {
                                xvnc,
                                xsession,
                                display,
                                rfbSocket
                            });
                            res(rfbSocket);
                        }
                    });
                });
                xvnc.on('exit', () => {
                    this.sessions.delete(username);
                });
            }
        });
    }
}