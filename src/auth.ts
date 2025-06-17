import { pamAuthenticatePromise, PamError } from "node-linux-pam";

export class AuthenticationProvider {
    private service: string;

    constructor(service: string) {
        this.service = service;    
    }

    async authenticate(username: string, password: string): Promise<true | string> {
        try {
            let result = await pamAuthenticatePromise({
                username,
                password,
                serviceName: this.service
            });
            return true;
        } catch (e) {
            if (e instanceof PamError) {
                return e.message;
            } else {
                throw e;
            }
        }
    }
}