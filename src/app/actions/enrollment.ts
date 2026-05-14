'use server';

import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';
import { createNotification, notifyOrganizationAdmins } from './notifications';
import { QuizAttemptResult } from '@/types/quiz';

// Helper: resolve the active session from either auth instance
async function resolveSession() {
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

/**
 * Get all available users (workers) that can be enrolled in courses.
 * Used by Share Modal to show selectable users.
 */
export async function getAvailableUsers() {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Get all users with worker role
  const users = await prisma.user.findMany({
    include: {
      profile: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    fullName: user.profile?.fullName || user.email,
    role: user.role || 'worker',
    avatarUrl: user.profile?.avatarUrl,
  }));
}

/**
 * Enroll users in a course by their email addresses.
 * Creates enrollment records for each valid email.
 * For emails not in the system, creates new user accounts and sends invite emails.
 */
export async function enrollUsers(courseId: string, emails: string[]) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Verify course exists and user owns it
  const course = await prisma.course.findUnique({
    where: { id: courseId },
  });

  if (!course || course.createdBy !== session.user.id) {
    throw new Error('Course not found');
  }

  // Get organization info for new user creation
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { organization: true },
  });

  const results = {
    success: [] as string[],
    alreadyEnrolled: [] as string[],
    newInvited: [] as string[],
    failed: [] as string[],
  };

  const bcrypt = await import('bcryptjs');
  const crypto = await import('crypto');
  const { sendCourseInviteEmail, sendCourseEnrollmentEmail } = await import('@/lib/email');

  // 1. Validate and deduplicate emails
  const validEmails = Array.from(
    new Set(
      emails.map((e) => e.toLowerCase().trim()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
    ),
  );

  const invalidEmails = emails.filter((e) => !validEmails.includes(e.toLowerCase().trim()));
  results.failed.push(...invalidEmails);

  if (validEmails.length === 0) {
    return results;
  }

  // 2. Fetch all existing users in a single query
  const existingUsers = await prisma.user.findMany({
    where: { email: { in: validEmails } },
    include: { profile: true },
  });

  const existingEmails = new Set(existingUsers.map((u) => u.email));
  const newEmails = validEmails.filter((email) => !existingEmails.has(email));

  const allUsers = [...existingUsers];
  const newInvitedUsers: { email: string; tempPass: string }[] = [];

  // 3. Create new users in a loop since we need to generate random passwords and hash them
  // (We could batch hash, but creating them individually here ensures we map passwords correctly)
  for (const email of newEmails) {
    try {
      const tempPassword = crypto.randomBytes(8).toString('hex');
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      const newUser = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          role: 'worker',
          emailVerified: true,
          organizationId: currentUser?.organizationId || null,
        },
      });
      allUsers.push({ ...newUser, profile: null });
      newInvitedUsers.push({ email, tempPass: tempPassword });
      results.newInvited.push(email);
    } catch (createErr) {
      console.error(`Failed to create user for ${email}:`, createErr);
      results.failed.push(email);
    }
  }

  // 4. Send invite emails concurrently using Promise.allSettled
  await Promise.allSettled(
    newInvitedUsers.map(async ({ email, tempPass }) => {
      try {
        await sendCourseInviteEmail(
          email,
          tempPass,
          course.title,
          currentUser?.organization?.name || 'Your Organization',
        );
      } catch (err) {
        console.error(`Failed to send invite email to ${email}:`, err);
      }
    }),
  );

  const userIds = allUsers.map((u) => u.id);

  if (userIds.length > 0) {
    // 5. Fetch existing enrollments in a single query
    const existingEnrollments = await prisma.enrollment.findMany({
      where: {
        courseId,
        userId: { in: userIds },
      },
      select: { userId: true },
    });

    const enrolledUserIds = new Set(existingEnrollments.map((e) => e.userId));

    const usersToEnroll = allUsers.filter((u) => !enrolledUserIds.has(u.id));
    const alreadyEnrolledUsers = allUsers.filter((u) => enrolledUserIds.has(u.id));

    // Record already enrolled (if they weren't just invited)
    for (const u of alreadyEnrolledUsers) {
      if (!results.newInvited.includes(u.email)) {
        results.alreadyEnrolled.push(u.email);
      }
    }

    if (usersToEnroll.length > 0) {
      // 6. Bulk create new enrollments
      await prisma.enrollment.createMany({
        data: usersToEnroll.map((u) => ({
          userId: u.id,
          courseId,
          status: 'enrolled',
          progress: 0,
        })),
        skipDuplicates: true,
      });

      // 7. Send notifications and enrollment emails concurrently
      const notificationPromises = usersToEnroll.map(async (user) => {
        try {
          await createNotification({
            userId: user.id,
            type: 'COURSE_ASSIGNED',
            title: 'New Course Assigned',
            message: `You have been assigned a new course: ${course.title}`,
            linkUrl: `/worker/trainings`,
            metadata: { courseId },
          });
        } catch (err) {
          console.error(`Failed to create notification for ${user.email}`, err);
        }

        if (!results.newInvited.includes(user.email)) {
          try {
            await sendCourseEnrollmentEmail(
              user.email,
              user.profile?.fullName || 'there',
              course.title,
              currentUser?.organization?.name || 'Your Organization',
            );
            results.success.push(user.email);
          } catch (err) {
            console.error(`Failed to send enrollment email to ${user.email}:`, err);
          }
        }
      });

      await Promise.allSettled(notificationPromises);
    }
  }

  revalidatePath(`/dashboard/training/courses/${courseId}`);
  return results;
}

/**
 * Get enrollment details with quiz results.
 */
export async function getEnrollmentWithResults(enrollmentId: string) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: {
        include: { profile: true, organization: true },
      },
      course: {
        include: {
          lessons: {
            include: {
              quiz: {
                include: {
                  questions: {
                    orderBy: { order: 'asc' },
                  },
                },
              },
            },
            orderBy: { order: 'asc' },
          },
        },
      },
      quizAttempts: {
        include: {
          quiz: {
            include: {
              questions: {
                orderBy: { order: 'asc' },
              },
            },
          },
        },
      },
    },
  });

  if (!enrollment) {
    throw new Error('Enrollment not found');
  }

  const isEnrolledUser = enrollment.userId === session.user.id;
  const isCourseCreator = enrollment.course.createdBy === session.user.id;

  if (!isEnrolledUser && !isCourseCreator) {
    throw new Error('Access denied');
  }

  return enrollment;
}

/**
 * Submit a quiz attempt with answers.
 */
export async function submitQuizAttempt(
  enrollmentId: string,
  quizId: string,
  answers: { questionId: string; selectedAnswer: string }[],
  timeTaken?: number,
): Promise<QuizAttemptResult> {
  const [admin, worker] = await Promise.all([
    (await import('@/auth')).auth(),
    (await import('@/auth.worker')).auth(),
  ]);
  const adminId = admin?.user?.id;
  const workerId = worker?.user?.id;

  if (!adminId && !workerId) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { course: true },
  });

  if (!enrollment || (enrollment.userId !== adminId && enrollment.userId !== workerId)) {
    throw new Error('Enrollment not found');
  }

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { questions: true },
  });

  if (!quiz) {
    throw new Error('Quiz not found');
  }

  let correctCount = 0;
  for (const answer of answers) {
    const question = quiz.questions.find((q) => q.id === answer.questionId);
    if (question && question.correctAnswer === answer.selectedAnswer) {
      correctCount++;
    }
  }

  const totalQuestions = quiz.questions.length;
  const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
  const passed = score >= quiz.passingScore;

  const existingAttempt = await prisma.quizAttempt.findUnique({
    where: {
      enrollmentId_quizId: {
        enrollmentId,
        quizId,
      },
    },
  });

  if (existingAttempt) {
    await prisma.quizAttempt.update({
      where: { id: existingAttempt.id },
      data: {
        answers,
        score,
        timeTaken,
        completedAt: new Date(),
      },
    });
  } else {
    await prisma.quizAttempt.create({
      data: {
        enrollmentId,
        quizId,
        answers,
        score,
        timeTaken,
      },
    });
  }

  if (!passed) {
    const user = await prisma.user.findUnique({
      where: { id: enrollment.userId },
      include: { profile: true },
    });

    if (user && user.organizationId) {
      await notifyOrganizationAdmins(user.organizationId, {
        type: 'COURSE_FAILED',
        title: 'Quiz Failed',
        message: `${user.profile?.fullName || user.email} has failed the quiz for course: ${enrollment.course?.title || 'Unknown Course'}.`,
        linkUrl: `/dashboard/staff/${user.id}`,
        metadata: { userId: user.id, courseId: enrollment.courseId, score },
      });
    }
  }

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'in_progress',
      score,
    },
  });

  revalidatePath(`/dashboard/training`);

  return {
    score,
    passed,
    correctCount,
    totalQuestions,
  };
}

/**
 * Worker requests a retry on a failed course quiz.
 */
export async function requestCourseRetry(enrollmentId: string) {
  const [admin, worker] = await Promise.all([
    (await import('@/auth')).auth(),
    (await import('@/auth.worker')).auth(),
  ]);
  const adminId = admin?.user?.id;
  const workerId = worker?.user?.id;

  if (!adminId && !workerId) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: { include: { profile: true } },
      course: true,
    },
  });

  if (!enrollment || (enrollment.userId !== adminId && enrollment.userId !== workerId)) {
    throw new Error('Enrollment not found');
  }

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'enrolled',
      score: null,
    },
  });

  if (enrollment.user.organizationId) {
    await notifyOrganizationAdmins(enrollment.user.organizationId, {
      type: 'COURSE_RETRY_REQUESTED',
      title: 'Course Retry Requested',
      message: `${enrollment.user.profile?.fullName || enrollment.user.email} has requested a retry for the course: ${enrollment.course.title}.`,
      linkUrl: `/dashboard/staff/${enrollment.user.id}`,
      metadata: { userId: enrollment.user.id, courseId: enrollment.courseId },
    });
  }

  revalidatePath(`/worker/trainings`);
  return { success: true };
}
