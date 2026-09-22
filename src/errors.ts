export class DatabaseError extends Error {
 constructor(){super('D1 operation failed');this.name='DatabaseError';}
}

export class MatchingError extends Error {
 constructor(){super('NJKB matching failed');this.name='MatchingError';}
}
