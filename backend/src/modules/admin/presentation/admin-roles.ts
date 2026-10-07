import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../generated/prisma/enums';

/**
 * Panel access: operators run the day to day (live map, trips, geofences, shared places) and
 * administrators also manage accounts, integrations, regions and the audit log.
 */
export const Staff = () => Roles(UserRole.ADMIN, UserRole.OPERATOR);

export const AdminOnly = () => Roles(UserRole.ADMIN);
