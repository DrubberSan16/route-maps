import { UserRole } from '../../../generated/prisma/enums';

export interface UserEntity {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Public projection: never exposes the password hash. */
export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
}

export const toUserProfile = (user: UserEntity): UserProfile => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  createdAt: user.createdAt,
});
