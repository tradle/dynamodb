
# Usage

## Notes

If you're taking advantage of index overloading, in your GSI's, project at least all the attributes that are required for calculating the indexed properties.

Suggested `deriveProperties` implementation:

Let's say you have 3 types in your table - Animals, Movies and MoviesAboutAnimals. You want to index the following properies: 

Animals
- species (hashKey)
- genus 
- yumminess

Movies
- title (hashKey)
- rating
- year

MoviesAboutAnimals
- animal (hashKey)
- title
- rating

```js
const tableDef = {
// ...
  hashKey: '__0h',
  rangeKey: '__0r',
  indexes: [
    {
//    ...
      hashKey: '__1h',
      rangeKey: '__1r'
    },
    {
//    ...
      hashKey: '__2h',
      rangeKey: '__2r'
    },
  ]
}

const toIndex = {
  Animal: ['genus', 'species', 'yumminess'],
  Movie: ['title', 'rating', 'year'],
  MovieAboutAnimals: ['title', 'rating', 'animal'],
}

const dogModel = {
  type: 'tradle.Model',
  id: 'tradle.Dog',
  properties: {
    genus: {
      type: 'string'
    },
    species: {
      type: 'string'
    },
    yumminess: {
      type: 'number'
    }
  },
  indexedProperties: [
    // primary key
    {
      hashKey: 'species',
      rangeKey: 'yumminess'
    },   
    // indexed properties
    {
      hashKey: 'genus',
      rangeKey: 'species'
    },
    {
      hashKey: 'yumminess'
      rangeKey: 'cuteness'
    }
  ]
}

const dog = {
  _t: 'Animal',
  genus: 'filius',
  species: 'lassius',
  yumminess: 7
}

const movie = {
  _t: 'Movie',
  title: 'The Matix',
  year: 1999
  rating: 10
}

const movieAboutAnimals = {
  _t: 'MovieAboutAnimals',
  title: 'Return of the Doghorse',
  year: 2065
  rating: 10,
  animal: 'doghorse'
}

const deriveProperties = (item, forRead) => {
  const inputs = _.pick(item, toIndex[item._t])

}

```
