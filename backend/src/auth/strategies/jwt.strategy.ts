import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Strategy } from 'passport-jwt';
import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { User } from '../../users/schemas/user.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { ROLE_DEFINITIONS } from '../../shared/authorization/roles';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  permissions: string[];
  departmentId?: string;
  tokenType?: string;
}

@Injectable()
export class JwtStrategyService extends PassportStrategy(JwtStrategy, 'jwt') {
  constructor(
    private configService: ConfigService,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: Request) => {
          if (!request?.cookies) return null;
          return request.cookies.accessToken;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'default-secret-change-me',
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.tokenType === 'refresh') {
      return {
        userId: payload.sub,
        isRefreshToken: true,
      };
    }

    const user = await this.userModel.findById(payload.sub).exec();
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const roles = user.roles || [];
    const permissions = ROLE_DEFINITIONS.filter((r) => roles.includes(r.name)).flatMap(
      (r) => r.permissions,
    );

    return {
      userId: user._id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      roles,
      permissions,
      departmentId: user.department_id,
      mustChangePassword: user.must_change_password,
      ipAddress: null,
    };
  }
}

export interface ValidatedUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  departmentId?: string;
  mustChangePassword: boolean;
  ipAddress: string | null;
}
