import { IsString, Length } from 'class-validator';

// The systemRole string must match the `name` of an existing role in the
// tenant — typically one of the six seeded built-ins (CEO, Admin, Manager,
// Supervisor, Employee, HR). The PermissionsGuard joins by name to compute
// effective permissions.
export class AssignSystemRoleDto {
  @IsString()
  @Length(1, 60)
  systemRole!: string;
}
