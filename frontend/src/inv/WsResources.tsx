import { useAuth } from '../App';
import { useWorkspace } from '../workspace/shared';
import { ResourcesPage } from './InventoryArea';

/** The department workspace's resources: the same single list, scoped to this department by the server. */
export default function WsResources() {
  const { department } = useWorkspace();
  const { user } = useAuth();
  return <ResourcesPage scope={{ departmentId: department.departmentId, departmentName: department.name, roles: user?.roles ?? [], leaderRole: department.role }} />;
}
