import { beforeEach, describe, expect, it, mock } from "bun:test";

// Exercise the real linking service while keeping its persistence boundary as
// in-memory rows, matching the lead timeline tests' Prisma-module mock style.
type ContactRow = {
  id: string;
  email: string;
  userId: string | null;
  linkSource: string | null;
  birthday: string | null;
  name: string;
  attribution: string | null;
};

type UserRow = {
  id: string;
  email: string;
  birthday: string | null;
  name: string | null;
  attribution: string | null;
};

type FindUniqueArgs = {
  where: { id?: string; email?: string };
};

type ContactUpdateArgs = {
  where: { id: string };
  data: Partial<
    Pick<ContactRow, "userId" | "linkSource" | "birthday" | "name" | "attribution">
  >;
};

type UserUpdateArgs = {
  where: { id: string };
  data: Partial<Pick<UserRow, "birthday" | "name" | "attribution">>;
};

const contacts: ContactRow[] = [];
const users: UserRow[] = [];
const contactUpdates: ContactUpdateArgs[] = [];
const userUpdates: UserUpdateArgs[] = [];

const contactModel = {
  findUnique: async (args: FindUniqueArgs): Promise<ContactRow | null> =>
    contacts.find(
      (contact) =>
        (args.where.id !== undefined && contact.id === args.where.id) ||
        (args.where.email !== undefined && contact.email === args.where.email)
    ) ?? null,
  update: async (args: ContactUpdateArgs): Promise<ContactRow> => {
    const contact = contacts.find((row) => row.id === args.where.id);
    if (!contact) throw new Error(`Mock contact ${args.where.id} not found`);
    contactUpdates.push(args);
    Object.assign(contact, args.data);
    return contact;
  },
};

const userModel = {
  findUnique: async (args: FindUniqueArgs): Promise<UserRow | null> =>
    users.find(
      (user) =>
        (args.where.id !== undefined && user.id === args.where.id) ||
        (args.where.email !== undefined && user.email === args.where.email)
    ) ?? null,
  update: async (args: UserUpdateArgs): Promise<UserRow> => {
    const user = users.find((row) => row.id === args.where.id);
    if (!user) throw new Error(`Mock user ${args.where.id} not found`);
    userUpdates.push(args);
    Object.assign(user, args.data);
    return user;
  },
};

type TransactionClient = {
  contact: typeof contactModel;
  user: typeof userModel;
};

const transactionModel = async <T>(
  callback: (tx: TransactionClient) => Promise<T>
): Promise<T> => callback({ contact: contactModel, user: userModel });

type PrismaModuleMock = {
  default: {
    contact: typeof contactModel;
    user: typeof userModel;
    $transaction: typeof transactionModel;
  };
};

function createPrismaMock(): PrismaModuleMock {
  return {
    default: {
      contact: contactModel,
      user: userModel,
      $transaction: transactionModel,
    },
  };
}

mock.module("@/lib/prisma", createPrismaMock);

const { autoLinkContact, linkContactToUser, unlinkContact } = await import(
  "@/lib/leads/linking"
);

function addContact(overrides: Partial<ContactRow> = {}): ContactRow {
  const contact: ContactRow = {
    id: "contact-1",
    email: "lead@example.com",
    userId: null,
    linkSource: null,
    birthday: null,
    name: "Lead",
    attribution: null,
    ...overrides,
  };
  contacts.push(contact);
  return contact;
}

function addUser(overrides: Partial<UserRow> = {}): UserRow {
  const user: UserRow = {
    id: "user-1",
    email: "lead@example.com",
    birthday: null,
    name: null,
    attribution: null,
    ...overrides,
  };
  users.push(user);
  return user;
}

beforeEach(() => {
  mock.module("@/lib/prisma", createPrismaMock);
  contacts.length = 0;
  users.length = 0;
  contactUpdates.length = 0;
  userUpdates.length = 0;
});

describe("lead linking", () => {
  it("auto-links a padded mixed-case contact email to the normalized stored user email", async () => {
    const contact = addContact({ email: "  Lead@Example.COM  " });
    const user = addUser({ email: "lead@example.com" });

    await autoLinkContact(contact.id);

    expect(contact.userId).toBe(user.id);
    expect(contact.linkSource).toBe("auto_email");
  });

  it("leaves an unmatched contact unlinked", async () => {
    const contact = addContact({ email: "nobody@example.com" });
    addUser({ email: "someone@example.com" });

    await autoLinkContact(contact.id);

    expect(contact.userId).toBeNull();
    expect(contact.linkSource).toBeNull();
    expect(contactUpdates).toHaveLength(0);
  });

  it("does not relink or clear a manual link during automatic linking", async () => {
    const contact = addContact({ userId: "manual-user", linkSource: "manual" });
    addUser({ id: "automatic-user" });

    await autoLinkContact(contact.id);

    expect(contact.userId).toBe("manual-user");
    expect(contact.linkSource).toBe("manual");
    expect(contactUpdates).toHaveLength(0);
  });

  it("marks an explicit link as manual", async () => {
    const contact = addContact();
    const user = addUser();

    await linkContactToUser(contact.id, user.id);

    expect(contact.userId).toBe(user.id);
    expect(contact.linkSource).toBe("manual");
  });

  it("clears both the user id and source when unlinking", async () => {
    const contact = addContact({ userId: "user-1", linkSource: "manual" });

    await unlinkContact(contact.id);

    expect(contact.userId).toBeNull();
    expect(contact.linkSource).toBeNull();
  });

  it("copies a contact birthday to an empty user birthday on link", async () => {
    const contact = addContact({ birthday: "1990-04-17" });
    const user = addUser();

    await linkContactToUser(contact.id, user.id);

    expect(user.birthday).toBe("1990-04-17");
    expect(userUpdates).toEqual([
      { where: { id: user.id }, data: { birthday: "1990-04-17" } },
    ]);
  });

  it("copies a user birthday to an empty contact birthday on link", async () => {
    const contact = addContact();
    const user = addUser({ birthday: "1985-12-03" });

    await linkContactToUser(contact.id, user.id);

    expect(contact.birthday).toBe("1985-12-03");
    expect(contactUpdates.at(-1)?.data).toEqual({ birthday: "1985-12-03" });
  });

  it("never overwrites either populated birthday", async () => {
    const contact = addContact({ birthday: "1990-04-17" });
    const user = addUser({ birthday: "1985-12-03" });

    await linkContactToUser(contact.id, user.id);

    expect(contact.birthday).toBe("1990-04-17");
    expect(user.birthday).toBe("1985-12-03");
    expect(userUpdates).toHaveLength(0);
    expect(contactUpdates.some((update) => "birthday" in update.data)).toBe(false);
  });

  it("does not issue a birthday write when both birthdays are empty", async () => {
    const contact = addContact();
    const user = addUser();

    await linkContactToUser(contact.id, user.id);

    expect(contact.birthday).toBeNull();
    expect(user.birthday).toBeNull();
    expect(userUpdates).toHaveLength(0);
    expect(contactUpdates.some((update) => "birthday" in update.data)).toBe(false);
  });

  it("SC-11 fills an empty User.name from the Contact", async () => {
    const contact = addContact({ name: "Ada Lovelace" });
    const user = addUser({ name: "   " });

    await linkContactToUser(contact.id, user.id);

    expect(user.name).toBe("Ada Lovelace");
    expect(userUpdates).toEqual([
      { where: { id: user.id }, data: { name: "Ada Lovelace" } },
    ]);
  });

  it("fills an empty Contact.name from the User", async () => {
    const contact = addContact({ name: "  " });
    const user = addUser({ name: "Grace Hopper" });

    await linkContactToUser(contact.id, user.id);

    expect(contact.name).toBe("Grace Hopper");
    expect(contactUpdates.at(-1)?.data).toEqual({ name: "Grace Hopper" });
  });

  it("SC-12 does not overwrite differing non-empty names", async () => {
    const contact = addContact({ name: "Contact Name" });
    const user = addUser({ name: "User Name" });

    await linkContactToUser(contact.id, user.id);

    expect(contact.name).toBe("Contact Name");
    expect(user.name).toBe("User Name");
    expect(userUpdates).toHaveLength(0);
    expect(contactUpdates.some((update) => "name" in update.data)).toBe(false);
  });

  it("SC-13 never copies the Lead placeholder onto a User", async () => {
    const contact = addContact();
    const user = addUser();

    await linkContactToUser(contact.id, user.id);

    expect(user.name).toBeNull();
    expect(userUpdates).toHaveLength(0);
  });

  it("replaces the Contact Lead placeholder from a non-empty User.name", async () => {
    const contact = addContact();
    const user = addUser({ name: "Katherine Johnson" });

    await linkContactToUser(contact.id, user.id);

    expect(contact.name).toBe("Katherine Johnson");
    expect(contactUpdates.at(-1)?.data).toEqual({ name: "Katherine Johnson" });
  });

  it("SC-14 fills empty attribution both ways and never overwrites first-touch", async () => {
    const contactFirst = addContact({
      id: "contact-first",
      email: "contact-first@example.com",
      attribution: "contact-first-touch",
    });
    const emptyUser = addUser({
      id: "empty-user",
      email: "contact-first@example.com",
    });
    const emptyContact = addContact({
      id: "empty-contact",
      email: "user-first@example.com",
    });
    const userFirst = addUser({
      id: "user-first",
      email: "user-first@example.com",
      attribution: "user-first-touch",
    });
    const populatedContact = addContact({
      id: "populated-contact",
      email: "different@example.com",
      attribution: "original-contact-touch",
    });
    const populatedUser = addUser({
      id: "populated-user",
      email: "different@example.com",
      attribution: "original-user-touch",
    });

    await linkContactToUser(contactFirst.id, emptyUser.id);
    await linkContactToUser(emptyContact.id, userFirst.id);
    await linkContactToUser(populatedContact.id, populatedUser.id);

    expect(emptyUser.attribution).toBe("contact-first-touch");
    expect(emptyContact.attribution).toBe("user-first-touch");
    expect(populatedContact.attribution).toBe("original-contact-touch");
    expect(populatedUser.attribution).toBe("original-user-touch");
    expect(userUpdates).toEqual([
      {
        where: { id: emptyUser.id },
        data: { attribution: "contact-first-touch" },
      },
    ]);
    expect(
      contactUpdates.filter((update) => "attribution" in update.data)
    ).toEqual([
      {
        where: { id: emptyContact.id },
        data: { attribution: "user-first-touch" },
      },
    ]);
  });

  it("treats whitespace-only attribution as empty", async () => {
    const contact = addContact({ attribution: "organic" });
    const user = addUser({ attribution: "  " });

    await linkContactToUser(contact.id, user.id);

    expect(user.attribution).toBe("organic");
    expect(userUpdates).toEqual([
      { where: { id: user.id }, data: { attribution: "organic" } },
    ]);
  });

  it("SC-15 keeps birthday synchronization unchanged while batching fields", async () => {
    const contact = addContact({
      birthday: "1990-04-17",
      name: "Ada Lovelace",
      attribution: "newsletter",
    });
    const user = addUser();

    await linkContactToUser(contact.id, user.id);

    expect(user).toMatchObject({
      birthday: "1990-04-17",
      name: "Ada Lovelace",
      attribution: "newsletter",
    });
    expect(userUpdates).toEqual([
      {
        where: { id: user.id },
        data: {
          birthday: "1990-04-17",
          name: "Ada Lovelace",
          attribution: "newsletter",
        },
      },
    ]);
  });

  it("does not issue a second linked-field write when synchronization is repeated", async () => {
    const contact = addContact({
      birthday: "1990-04-17",
      name: "Ada Lovelace",
      attribution: "newsletter",
    });
    const user = addUser();

    await linkContactToUser(contact.id, user.id);
    userUpdates.length = 0;
    contactUpdates.length = 0;

    await linkContactToUser(contact.id, user.id);

    expect(userUpdates).toHaveLength(0);
    expect(contactUpdates).toEqual([
      {
        where: { id: contact.id },
        data: { userId: user.id, linkSource: "manual" },
      },
    ]);
  });

  it("reports the contact id when manual linking cannot find the contact", async () => {
    addUser();

    await expect(linkContactToUser("missing-manual", "user-1")).rejects.toThrow(
      "missing-manual"
    );
  });

  it("reports the contact id when automatic linking cannot find the contact", async () => {
    await expect(autoLinkContact("missing-auto")).rejects.toThrow("missing-auto");
  });
});
