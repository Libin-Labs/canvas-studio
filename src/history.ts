export class History<T> {
  private entries: T[];
  private cursor = 0;
  private transactionStart: T | undefined;

  constructor(
    initial: T,
    private readonly clone: (value: T) => T,
    private readonly limit = 100,
  ) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new RangeError('History limit must be a positive integer.');
    this.entries = [clone(initial)];
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }
  get canRedo(): boolean {
    return this.cursor < this.entries.length - 1;
  }
  get inTransaction(): boolean {
    return this.transactionStart !== undefined;
  }

  begin(): void {
    if (this.inTransaction) throw new Error('A history transaction is already active.');
    this.transactionStart = this.clone(this.current());
  }

  commit(value: T): boolean {
    if (!this.inTransaction) throw new Error('No history transaction is active.');
    const start = this.transactionStart as T;
    this.transactionStart = undefined;
    if (JSON.stringify(start) === JSON.stringify(value)) return false;
    this.push(value);
    return true;
  }

  cancel(): T {
    if (!this.inTransaction) throw new Error('No history transaction is active.');
    const start = this.transactionStart as T;
    this.transactionStart = undefined;
    return this.clone(start);
  }

  record(value: T): boolean {
    if (this.inTransaction) throw new Error('Cannot record while a history transaction is active.');
    if (JSON.stringify(this.current()) === JSON.stringify(value)) return false;
    this.push(value);
    return true;
  }

  undo(): T | undefined {
    if (this.inTransaction) throw new Error('Cannot undo while a history transaction is active.');
    if (!this.canUndo) return undefined;
    this.cursor -= 1;
    return this.clone(this.current());
  }

  redo(): T | undefined {
    if (this.inTransaction) throw new Error('Cannot redo while a history transaction is active.');
    if (!this.canRedo) return undefined;
    this.cursor += 1;
    return this.clone(this.current());
  }

  private current(): T {
    return this.entries[this.cursor];
  }

  private push(value: T): void {
    this.entries.splice(this.cursor + 1);
    this.entries.push(this.clone(value));
    if (this.entries.length > this.limit + 1) this.entries.shift();
    this.cursor = this.entries.length - 1;
  }
}
