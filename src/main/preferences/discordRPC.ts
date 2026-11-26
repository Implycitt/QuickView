import { Client } from "@nxenjs/discord-rich-presence";

const clientId = "1575422933684461669";
const rpc = new Client();

rpc.on("ready", () => {
    console.log("setting activity");
    void rpc.setActivity({
        details: "Reading a doc",
        state: "QuickView",
        assets: { large_image: "quickview", large_text: "QuickView" }
    });
});

void rpc.login(clientId).catch((error: unknown) => {
    console.warn("Discord rich presence unavailable: ", error);
});
