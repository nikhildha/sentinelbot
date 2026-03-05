import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import crypto from 'crypto';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Return success even if user not found to prevent enumeration
      return NextResponse.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
    }

    // Generate token
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 3600000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: token,
        resetTokenExpiry: expiry,
      },
    });

    // Mock Email Sending (Log to console)
    // In production, use Resend, SendGrid, etc.
    const resetLink = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
    console.log('---------------------------------------------------');
    console.log(`[Forgot Password] Reset Link for ${email}:`);
    console.log(resetLink);
    console.log('---------------------------------------------------');

    return NextResponse.json({ 
      success: true, 
      message: 'If an account exists, a reset link has been sent.',
      // DEBUG ONLY: Remove in production or keep for easy testing since we don't have email setup
      debug_token: token 
    });

  } catch (error) {
    console.error('[forgot-password] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
