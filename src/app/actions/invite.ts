'use server';

import { PrismaClient } from '@prisma/client';
import { sendInviteEmail } from '@/lib/email';

const prisma = new PrismaClient();

export interface InviteResultItem {
  email: string;
  status: 'sent' | 'pending' | 'exists' | 'error' | 'resent';
  message?: string;
}

interface InviteResult {
  success: boolean; // Overall success (true if at least one processed without system error)
  results: InviteResultItem[];
  error?: string;
}

export async function createInvites(
  emails: string[],
  role: string,
  organizationId: string,
  inviterId?: string,
): Promise<InviteResult> {
  if (!emails.length) return { success: false, results: [], error: 'No emails provided' };
  if (!organizationId) return { success: false, results: [], error: 'Organization ID is required' };

  const results: InviteResultItem[] = [];

  try {
    // Fetch organization name for the email
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    if (!org) return { success: false, results: [], error: 'Organization not found' };

    const invitePromises = emails.map(async (email): Promise<InviteResultItem> => {
      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email },
        include: { organization: true },
      });

      if (existingUser) {
        if (existingUser.organizationId === organizationId) {
          return { email, status: 'exists', message: 'User is already a member.' };
        } else {
          // User exists but in another org or no org.
          // Ideally we'd invite them to join *this* org, but for now just report they have an account.
          return {
            email,
            status: 'exists',
            message: 'User already has an account. Ask them to login.',
          };
        }
      }

      // Check if invite already pending
      const existingInvite = await prisma.invite.findFirst({
        where: { email, organizationId, status: 'pending' },
      });

      if (existingInvite) {
        // Resend Email
        const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/join/${existingInvite.token}`;
        await sendInviteEmail(email, inviteLink, org.name, role);
        return { email, status: 'resent', message: 'Invitation resent.' };
      }

      const token = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

      // Create Invite Record
      await prisma.invite.create({
        data: {
          email,
          token,
          organizationId,
          role,
          expiresAt,
          invitedBy: inviterId,
          status: 'pending',
        },
      });

      // Send Email
      const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/join/${token}`;
      await sendInviteEmail(email, inviteLink, org.name, role);

      return { email, status: 'sent', message: 'Invitation sent.' };
    });

    const settledResults = await Promise.allSettled(invitePromises);

    for (let i = 0; i < settledResults.length; i++) {
      const result = settledResults[i];
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.error(`Error processing invite for ${emails[i]}:`, result.reason);
        results.push({
          email: emails[i],
          status: 'error',
          message: 'Failed to process invitation.',
        });
      }
    }

    return { success: true, results };
  } catch (error) {
    console.error('Error creating invites:', error);
    return { success: false, results: [], error: 'Failed to process requests' };
  }
}
