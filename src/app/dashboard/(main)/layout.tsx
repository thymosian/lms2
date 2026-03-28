import React from 'react';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import DashboardLayoutClient from '@/components/dashboard/DashboardLayoutClient';
import OrganizationActivationModal from '@/components/dashboard/OrganizationActivationModal';
import { AdminSessionProvider } from '@/components/providers/AdminSessionProvider';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user?.email) {
    redirect('/login');
  }

  // Fetch fresh user data and profile from DB in a single query to prevent N+1
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      organizationId: true,
      role: true,
      profile: {
        select: { fullName: true },
      },
    },
  });

  const fullName = user?.profile?.fullName || session.user.name || session.user.email || 'User';
  // User role should be in session or fetched from User model if needed.
  // For now we rely on session.
  // User role should be in session or fetched from User model if needed.
  // For now we rely on session.
  const role = user?.role || session.user.role;
  const organizationId = user?.organizationId; // Fetch from DB for freshest data

  return (
    <AdminSessionProvider>
      <OrganizationActivationModal hasOrganization={!!organizationId} />
      <DashboardLayoutClient
        userEmail={session.user.email || ''}
        fullName={fullName}
        role={role || undefined}
      >
        {children}
      </DashboardLayoutClient>
    </AdminSessionProvider>
  );
}
