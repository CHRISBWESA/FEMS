import { useAuth } from '../App';
import { useWorkspace } from '../workspace/shared';
import { InventoryShell } from './InventoryArea';

/**
 * The department workspace's resources: the department's own resources, fellowship resources assigned to it and
 * its requests. The same screens as the Treasurer's, scoped to this department by the server.
 */
export default function WsResources() {
  const { department, path } = useWorkspace();
  const { user } = useAuth();
  return <InventoryShell scope={{ departmentId: department.departmentId, departmentName: department.name, roles: user?.roles ?? [], leaderRole: department.role, base: path('resources') }} />;
}
