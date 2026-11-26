declare module "@nxenjs/discord-rich-presence" {
    export class Client {
        login(clientId: string): Promise<Client>;
        destroy(): Promise<void>;
        setActivity(activity: Record<string, unknown> | null, pid?: number): boolean;
        clearActivity(pid?: number): boolean;
        on(event: "ready", listener: () => void): this;
        on(event: "close" | "error", listener: (error?: unknown) => void): this;
    }
}
