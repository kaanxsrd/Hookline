import { describe, expect, it } from "vitest";
import { allowedAddress, checkDestinationUrl } from "./destination-url";

describe("allowedAddress", () => {
  it.each([
    ["93.184.216.34", true],
    ["2606:2800:220:1:248:1893:25c8:1946", true],
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.20.0.1", false],
    ["192.168.1.1", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["255.255.255.255", false],
    ["::1", false],
    ["::", false],
    ["fe80::1", false],
    ["fd00::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:7f00:1", false],
    ["::ffff:93.184.216.34", true],
    ["64:ff9b::a9fe:a9fe", false],
    ["2002:7f00:1::", false],
    ["2002:5db8:d822::", true],
    ["not-an-ip", false],
  ])("%s → %s", (address, allowed) => {
    expect(allowedAddress(address)).toBe(allowed);
  });
});

describe("checkDestinationUrl", () => {
  const publicDns = async () => ["93.184.216.34"];
  const privateDns = async () => ["93.184.216.34", "10.0.0.5"];
  const strict = { allowPrivate: false, resolve: publicDns };

  it("accepts public http(s) URLs", async () => {
    expect(await checkDestinationUrl("https://hooks.example.com/in?x=1", strict)).toBeNull();
    expect(await checkDestinationUrl("http://hooks.example.com:8443/", strict)).toBeNull();
  });

  it("rejects malformed and non-http URLs", async () => {
    expect(await checkDestinationUrl("hooks.example.com", strict)).toMatch(/full URL/);
    expect(await checkDestinationUrl("ftp://hooks.example.com", strict)).toMatch(/http/);
    expect(await checkDestinationUrl("https://u:p@hooks.example.com", strict)).toMatch(
      /credentials/,
    );
    expect(await checkDestinationUrl("https://hooks.example.com:22", strict)).toMatch(/Port 22/);
  });

  it("rejects internal targets", async () => {
    expect(await checkDestinationUrl("http://localhost:3000", strict)).toMatch(/localhost/);
    expect(await checkDestinationUrl("http://api.localhost:3000", strict)).toMatch(/localhost/);
    expect(await checkDestinationUrl("http://127.0.0.1:3000", strict)).toMatch(/private/);
    expect(await checkDestinationUrl("http://[::1]:3000", strict)).toMatch(/private/);
    expect(await checkDestinationUrl("http://169.254.169.254/latest", strict)).toMatch(/private/);
    expect(
      await checkDestinationUrl("https://sneaky.example.com", {
        allowPrivate: false,
        resolve: privateDns,
      }),
    ).toMatch(/private/);
    expect(
      await checkDestinationUrl("https://nowhere.invalid", {
        allowPrivate: false,
        resolve: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).toMatch(/resolve/);
  });

  it("allows private targets when the instance permits them", async () => {
    expect(await checkDestinationUrl("http://localhost:3999/x", { allowPrivate: true })).toBeNull();
    // The port rule still applies.
    expect(await checkDestinationUrl("http://localhost:25", { allowPrivate: true })).toMatch(
      /Port/,
    );
  });
});
