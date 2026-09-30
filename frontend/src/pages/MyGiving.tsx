import GivingStatement from '../components/finance/GivingStatement';

// A member's own giving history. The server only ever returns the member record linked to the signed-in account.
export default function MyGiving() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Giving</h1>
          <p className="page-desc">Your own contributions and pledges. Only you and authorised finance officers can see this.</p>
        </div>
      </div>
      <GivingStatement url="/finance/my-contributions" />
    </div>
  );
}
