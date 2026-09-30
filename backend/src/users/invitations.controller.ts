import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InvitationsService } from './invitations.service';
import { Public } from '../shared/decorators/public.decorator';
import { PUBLIC_THROTTLE } from '../shared/throttle';

/**
 * Appointing the people who hold a fellowship's offices.
 *
 * The two halves are separated deliberately. Everything that needs an account is behind the usual guards; the
 * acceptance route is `@Public()` because the person arriving at it has, by definition, never signed in - that is
 * the whole point of an invitation. It is therefore the most exposed route in the module, and it is protected by
 * what it holds rather than by who it knows: a 32-byte single-use token, stored hashed, that grants exactly the
 * roles named in the row and nothing else.
 */
@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  // ---------------------------------------------------------------- the fellowship's side (signed in)

  @Get('invitations')
  async list(@Req() req) {
    // Reads the fellowship's own invitations. The service resolves the fellowship from the signed-in account, so
    // there is no id in this URL to point at somebody else's.
    return this.invitations.list(req.user, req.query.fellowshipId);
  }

  // No `requirePermission` on these three, deliberately.
  //
  // The check belongs in the service, where it can derive authority from the requester's ROLES - the same rule
  // `UsersService` uses, and the same rule applied at the moment the roles are actually promised. A permission
  // claim read off the token here would be a second, weaker copy of the rule: a stale `permissions` array would
  // then decide who may appoint a Treasurer, which is exactly what the role-derived check exists to prevent.

  @Post('invitations')
  async invite(@Req() req, @Body() body: any) {
    return this.invitations.invite(req.user, body, req.query.fellowshipId);
  }

  @Post('invitations/:id/revoke')
  async revoke(@Req() req, @Param('id') id: string) {
    return this.invitations.revoke(req.user, id, req.query.fellowshipId);
  }

  @Post('invitations/:id/reissue')
  async reissue(@Req() req, @Param('id') id: string, @Body() body: any) {
    return this.invitations.reissue(req.user, id, body, req.query.fellowshipId);
  }

  // ---------------------------------------------------------------- the invitee's side (unauthenticated)

  /**
   * What this invitation is, for the acceptance page.
   *
   * Returns no token and nothing reusable - the caller already has the token in the URL, and this is what to show
   * them about it. A bad token and a withdrawn one answer alike, so the route cannot be used to discover which
   * tokens once existed.
   */
  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get('invitations/peek/:token')
  peek(@Param('token') token: string) {
    return this.invitations.peek(token);
  }

  /**
   * Accepting, which creates the account.
   *
   * Throttled at the public budget like the other unauthenticated writes, and it is the one unauthenticated route
   * that creates anything, so the rate limit is the outermost thing standing between a script and a table of
   * accounts. A wrong password attempt costs nothing because there is no password to guess - the token is the
   * secret - but repeated attempts against a valid token would otherwise be free.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('invitations/accept/:token')
  accept(@Param('token') token: string, @Body() body: any) {
    return this.invitations.accept(token, body);
  }
}
