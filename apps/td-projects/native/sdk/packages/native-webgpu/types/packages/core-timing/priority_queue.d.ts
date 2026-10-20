interface PriorityQueueItem<T> {
    id: string;
    deadline: number;
    metadata: T;
}
export declare class PriorityQueue<T> {
    private heap;
    private idToIndex;
    private logWarnings;
    add(id: string, deadline: number, metadata: T): void;
    peek(): PriorityQueueItem<T> | null;
    pop(): PriorityQueueItem<T> | null;
    remove(id: string): boolean;
    adjustDeadline(id: string, newDeadline: number): boolean;
    getData(id: string): T | null;
    size(): number;
    isEmpty(): boolean;
    private heapifyUp;
    private heapifyDown;
    private swap;
}
export {};
