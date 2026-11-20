import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteButton } from '../app/components/DeleteButton';
import { deleteTask } from '../app/actions';

jest.mock('../app/actions', () => ({
  deleteTask: jest.fn(),
}));

const mockedDelete = deleteTask as jest.MockedFunction<typeof deleteTask>;

beforeEach(() => {
  mockedDelete.mockReset();
});

describe('DeleteButton', () => {
  it('renders a Delete button for a task row', () => {
    render(<DeleteButton id={1} title="one" />);
    expect(screen.getByRole('button', { name: 'Delete one' })).toHaveTextContent('Delete');
  });

  it('calls deleteTask with the row id and shows no error on success', async () => {
    mockedDelete.mockResolvedValue({ ok: true });
    render(<DeleteButton id={7} title="seven" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete seven' }));
    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith(7));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an ErrorMessage when the API returns 404', async () => {
    mockedDelete.mockResolvedValue({ ok: false, error: 'Task 5 not found' });
    render(<DeleteButton id={5} title="five" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete five' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Task 5 not found');
    // The button stays so the row is not removed by the UI.
    expect(screen.getByRole('button', { name: 'Delete five' })).toBeInTheDocument();
  });

  it('shows an ErrorMessage for other API errors', async () => {
    mockedDelete.mockResolvedValue({ ok: false, error: 'Request failed (500)' });
    render(<DeleteButton id={2} title="two" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete two' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Request failed (500)');
  });

  it('shows an ErrorMessage when the server is unreachable', async () => {
    mockedDelete.mockResolvedValue({ ok: false, error: 'Could not reach the server' });
    render(<DeleteButton id={3} title="three" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete three' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
  });

  it("a failure in one row does not affect another row's button or error state", async () => {
    mockedDelete.mockImplementation(async (id) =>
      id === 1 ? { ok: false, error: 'Task 1 not found' } : { ok: true },
    );
    render(
      <>
        <DeleteButton id={1} title="one" />
        <DeleteButton id={2} title="two" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete one' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Task 1 not found');
    expect(screen.getByRole('button', { name: 'Delete two' })).toBeEnabled();
    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(mockedDelete).toHaveBeenCalledWith(1);
  });
});
