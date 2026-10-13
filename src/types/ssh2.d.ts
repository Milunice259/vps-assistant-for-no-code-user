declare module "ssh2" {
  export class Client {
    on(event: "error" | "close", listener: () => void): this;
    end(): this;
    connect(config: {
      host: string;
      port: number;
      username: string;
      readyTimeout: number;
      hostVerifier: (key: Buffer) => boolean;
    }): this;
  }
}
