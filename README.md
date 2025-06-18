# vnc-session-host

A VNC server wrapper that allows multiple users on the system to have detachable VNC sessions using their username and password. Similar in functionality to Remote Desktop Session Host on Windows Server

## Client Compatibility

This server should work with any client that supports the X509Plain security type. Out of the major servers, this seems to consist of:

- TigerVNC
- UltraVNC

## Usage

This server must be run as root and requires tigervnc to be installed with the `Xvnc` binary available.

```bash
# Install dependencies
yarn
# Build typescript
yarn tsc
# Run server
sudo \
    RFB_HOST=0.0.0.0 \
    RFB_PORT=5900 \
    RFB_CERT=/etc/letsencrypt/live/example.com/fullchain.pem \
    RFB_KEY=/etc/letsencrypt/live/example.com/privkey.pem \ 
    RFB_PAM_SERVICE=vnc \
    node ./dist/index.js
```

## Configuration

The server can be configured with the following environment variables:

- `RFB_HOST`: IP address of the interface for the RFB server to bind to. Defaults to all interfaces
- `RFB_PORT`: RFB port to listen on. Defaults to `5900`
- `RFB_CERT`: The path to a TLS certificate
- `RFB_KEY`: The path to a TLS certificate key
- `RFB_PAM_SERVICE`: The PAM service to use for authentication. Defaults to `vnc`

## PAM service

The server requires a valid PAM service for authentication. The default is `vnc`.

### Allow all users

The following example allows any user on the system allowed to login to connect to VNC

**/etc/pam.d/vnc**
```
#%PAM-1.0

auth       requisite    pam_nologin.so
auth       include      system-remote-login
account    include      system-remote-login
session    include      system-remote-login
password   include      system-remote-login
```

### Allow by group

The following example allows any user in the `vnc` and `wheel` groups to connect to VNC

**/etc/pam.d/vnc**
```
#%PAM-1.0

auth       requisite    pam_nologin.so
auth	   required	pam_listfile.so onerr=fail item=group sense=allow file=/etc/vnc.group.allow
auth       include      system-remote-login
account    include      system-remote-login
session    include      system-remote-login
password   include      system-remote-login
```

**/etc/vnc.group.allow**
```
vnc
wheel
```