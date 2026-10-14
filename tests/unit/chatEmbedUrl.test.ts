import { describe, expect, test } from "bun:test";
import { buildChatEmbedUrl, isTrustedChatOrigin } from "@/lib/chat/embedUrl";

describe("isTrustedChatOrigin", () => {
  const chatUrl = "https://chat.example.com";

  test("accepts the exact chat origin", () => {
    expect(isTrustedChatOrigin(chatUrl, "https://chat.example.com")).toBe(true);
  });

  test("ignores postMessage from a prefix-matching foreign origin", () => {
    // The old check was `chatUrl.startsWith(event.origin)`, so this passed.
    expect(isTrustedChatOrigin(chatUrl, "https://chat.example.co")).toBe(false);
  });

  test("ignores a different scheme and a different host", () => {
    expect(isTrustedChatOrigin(chatUrl, "http://chat.example.com")).toBe(false);
    expect(isTrustedChatOrigin(chatUrl, "https://evil.example.com")).toBe(false);
  });

  test("tolerates a chat url carrying a path or trailing slash", () => {
    expect(isTrustedChatOrigin("https://chat.example.com/", "https://chat.example.com")).toBe(true);
  });

  test("returns false for a malformed chat url instead of throwing", () => {
    expect(isTrustedChatOrigin("not a url", "https://chat.example.com")).toBe(false);
  });
});

describe("buildChatEmbedUrl", () => {
  test("defaults to the single-group path", () => {
    expect(
      buildChatEmbedUrl({ chatUrl: "https://chat.example.com", channelName: "cohort-x", authToken: null }),
    ).toBe("https://chat.example.com/group/cohort-x");
  });

  test("appends the resume token when present", () => {
    expect(
      buildChatEmbedUrl({ chatUrl: "https://chat.example.com", channelName: "cohort-x", authToken: "t0k" }),
    ).toBe("https://chat.example.com/group/cohort-x?resumeToken=t0k");
  });

  test("honours an explicit path so /chat can embed the full RC app", () => {
    expect(
      buildChatEmbedUrl({ chatUrl: "https://chat.example.com", path: "/home", authToken: "t0k" }),
    ).toBe("https://chat.example.com/home?resumeToken=t0k");
  });

  test("strips a trailing slash from the chat url", () => {
    expect(
      buildChatEmbedUrl({ chatUrl: "https://chat.example.com/", path: "/home", authToken: null }),
    ).toBe("https://chat.example.com/home");
  });

  test("url-encodes the channel name and token", () => {
    expect(
      buildChatEmbedUrl({ chatUrl: "https://chat.example.com", channelName: "a b", authToken: "a+b/c" }),
    ).toBe("https://chat.example.com/group/a%20b?resumeToken=a%2Bb%2Fc");
  });
});
