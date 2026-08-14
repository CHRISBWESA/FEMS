import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Member } from '../shared/schemas/members-departments.schema';
import { Activity } from '../shared/schemas/activities-reports.schema';
import { Department } from '../shared/schemas/members-departments.schema';

@Controller('dashboard')
export class DashboardController {
  constructor(
    @InjectModel(Member.name) private memberModel: Model<Member>,
    @InjectModel(Activity.name) private activityModel: Model<Activity>,
    @InjectModel(Department.name) private departmentModel: Model<Department>,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getDashboard(@Req() req) {
    const [memberCount, activityCount, deptCount] = await Promise.all([
      this.memberModel.countDocuments().exec(),
      this.activityModel.countDocuments().exec(),
      this.departmentModel.countDocuments().exec(),
    ]);

    return {
      totalMembers: memberCount,
      totalActivities: activityCount,
      totalDepartments: deptCount,
      recentActions: [],
    };
  }
}

@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  getProfile(@Req() req) {
    return {
      id: req.user.userId,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      roles: req.user.roles,
      isActive: true,
      mustChangePassword: req.user.mustChangePassword,
    };
  }
}
