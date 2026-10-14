// src/lib/rocketchat.ts
import { createHmac } from 'crypto';
import { logger } from './logger';

interface RCUser {
  _id: string;
  username: string;
}

// 1. Shared password used to create and log in shadow accounts
function buildDeterministicPassword(email: string): string {
  const secret = process.env.RC_PASSWORD_SECRET;
  if (!secret) throw new Error('RC_PASSWORD_SECRET is not set');
  const hash = createHmac('sha256', secret).update(email.toLowerCase().trim()).digest('hex');
  return `${hash}Lms1!`;
}

export class RocketChatService {
  private static readonly API_URL = process.env.RC_URL!;
  private static readonly ADMIN_ID = process.env.RC_ADMIN_USER_ID!;
  private static readonly ADMIN_TOKEN = process.env.RC_ADMIN_AUTH_TOKEN!;

  private static get botHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-User-Id': this.ADMIN_ID,
      'X-Auth-Token': this.ADMIN_TOKEN,
    };
  }

  // Find or create the user
  // 1. Create the user (never overwrites an existing password)
  static async syncUser(name: string, email: string, role: 'guest' | 'user' = 'guest'): Promise<string | null> {
    try {
      const password = buildDeterministicPassword(email);
      const query = encodeURIComponent(JSON.stringify({ 'emails.address': email }));
      const findRes = await fetch(`${this.API_URL}/api/v1/users.list?query=${query}`, { headers: this.botHeaders });
      
      if (!findRes.ok) return null;
      const findData = await findRes.json();
      
      const existing = findData.users?.find((u: any) => 
        u.emails?.some((e: any) => e.address.toLowerCase() === email.toLowerCase())
      );

      // If the user already exists in RC, just return their ID.
      // Their password is never touched.
      if (existing) {
        logger.info(`[RC] User ${email} exists (id=${existing._id}). Password sync skipped to protect admins.`);
        return existing._id;
      }

      // Otherwise create a new student with the guest role
      const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const username = `${baseUsername}${Math.floor(1000 + Math.random() * 9000)}`;

      const createRes = await fetch(`${this.API_URL}/api/v1/users.create`, {
        method: 'POST',
        headers: this.botHeaders,
        body: JSON.stringify({
          name, 
          email, 
          username, 
          password, 
          // Cohort students stay 'guest'; paying members get 'user' — RC guest
          // accounts can be channel-capped by workspace config.
          roles: [role],
          active: true, 
          verified: true, 
          requirePasswordChange: false, 
          sendWelcomeEmail: false,
        }),
      });

      const createData = await createRes.json();
      return createData.success ? createData.user._id : null;
    } catch (error) {
      logger.error({ err: error }, '[RC] syncUser exception:');
      return null;
    }
  }

  // 2. Add to the group (without duplicate invites)
  static async syncCohortGroup(cohortTitle: string, memberIds: string[]): Promise<string | null> {
    const groupName = `cohort-${cohortTitle.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    return this.syncGroup(groupName, memberIds);
  }

  // Generic create-or-diff-invite for any private group (members lounge, pods).
  // Same semantics as syncCohortGroup, but the caller owns the group name.
  static async syncGroup(groupName: string, memberIds: string[]): Promise<string | null> {
    try {
      const uniqueMembers = Array.from(new Set(memberIds.filter(Boolean)));

      const createRes = await fetch(`${this.API_URL}/api/v1/groups.create`, {
        method: 'POST',
        headers: this.botHeaders,
        body: JSON.stringify({ name: groupName, members: uniqueMembers }),
      });
      const createData = await createRes.json();

      if (createData.success) return createData.group._id;

      if (createData.errorType === 'error-duplicate-channel-name') {
        const infoRes = await fetch(`${this.API_URL}/api/v1/groups.info?roomName=${encodeURIComponent(groupName)}`, { headers: this.botHeaders });
        const infoData = await infoRes.json();
        
        if (infoData.success) {
          const roomId = infoData.group._id;
          
          // First fetch who is already in the group
          const membersRes = await fetch(`${this.API_URL}/api/v1/groups.members?roomId=${roomId}&count=100`, { headers: this.botHeaders });
          const membersData = await membersRes.json();
          const existingIds = new Set(membersData.members?.map((m: any) => m._id) || []);
          
          // Invite only the missing members
          for (const userId of uniqueMembers) {
             if (!existingIds.has(userId)) {
               await fetch(`${this.API_URL}/api/v1/groups.invite`, {
                 method: 'POST',
                 headers: this.botHeaders,
                 body: JSON.stringify({ roomId, userId }),
               });
             }
          }
          return roomId;
        }
      }
      return null;
    } catch (error) {
      logger.error({ err: error }, '[RC] syncCohortGroup exception:');
      return null;
    }
  }

  /** Resolve a group's current name from its room id. Used to backfill
   *  cohort.rocketchatChannelName for groups created before we stored the name,
   *  so a cohort renamed in the hub still points at its real chat history. */
  static async getGroupNameById(roomId: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.API_URL}/api/v1/groups.info?roomId=${encodeURIComponent(roomId)}`, {
        headers: this.botHeaders,
      });
      const data = await res.json();
      return data.success ? (data.group?.name ?? null) : null;
    } catch (error) {
      logger.error({ err: error }, '[RC] getGroupNameById exception:');
      return null;
    }
  }

  // Login: issue a token for the iframe
  static async createIframeToken(email: string): Promise<string | null> {
    try {
        // Try to log in with the same deterministic password
      const password = buildDeterministicPassword(email);
      
      const res = await fetch(`${this.API_URL}/api/v1/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: email, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        // Login failed: the person changed their password (a manager account).
        // Return null so the LMS opens the chat without a token
        // and the manager signs in themselves.
        logger.info(`[RC] Manual login required for ${email}. Custom password detected.`);
        return null; 
      }

      logger.info(`[RC] Seamless login successful for ${email}`);
      return data.data.authToken;
    } catch (error) {
      logger.error({ err: error }, '[RC] createIframeToken exception:');
      return null;
    }
  }

  static async getUnreadCount(email: string, rcUserId: string): Promise<number> {
    if (!rcUserId) return 0;
    
    try {
      const res = await fetch(`${this.API_URL}/api/v1/subscriptions.get`, {
        // Admin token, with rcUserId so the request runs on behalf of the user
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': this.ADMIN_TOKEN,
          'X-User-Id': rcUserId, 
        },
        // No caching: the unread count changes constantly
        cache: 'no-store'
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        logger.error(`[RC] Failed to fetch unread count for ${email}:`, data.error || res.statusText);
        return 0;
      }

      // Sum unread messages across all chats (the update array)
      if (data.update && Array.isArray(data.update)) {
        return data.update.reduce(
          (acc: number, sub: { unread?: number }) => acc + (sub.unread || 0), 
          0
        );
      }

      return 0;
    } catch (error) {
      logger.error({ err: error }, '[RC] getUnreadCount exception:');
      return 0;
    }
  }
}