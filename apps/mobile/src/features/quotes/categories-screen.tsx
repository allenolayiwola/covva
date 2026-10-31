import { useState } from 'react';
import { CATEGORY_AVAILABILITY, DEMO_DISCLAIMER } from '@im/core';
import { Button, Card, Copy, Screen } from '../../components/ui';
import { Badge, ListDetail, ResourceState } from './components';
import type { Category, CategoryDetail } from './model';
import { RiskForm } from './risk-form';
import { useApiResource } from './use-api-resource';

function Detail({ slug }: { slug: string }) {
  const resource = useApiResource<CategoryDetail>(`/catalog/categories/${encodeURIComponent(slug)}`);
  const category = resource.data?.category;
  return <><ResourceState {...resource} />{category ? <>
    <Card><Copy>{category.name}</Copy><Badge {...{ label: CATEGORY_AVAILABILITY[category.availability].label, tone: CATEGORY_AVAILABILITY[category.availability].tone }} />
      <Copy>{category.description}</Copy><Copy>{CATEGORY_AVAILABILITY[category.availability].promise}</Copy>
      <Copy>{resource.data?.productsCount} approved products from {resource.data?.insurersCount} participating insurers.</Copy>
      {resource.data?.demoMode ? <Copy>{DEMO_DISCLAIMER}</Copy> : null}
    </Card>
    {category.availability !== 'planned' ? <RiskForm key={category.id} category={category} /> : null}
  </> : null}</>;
}
export function CategoriesScreen() {
  const resource = useApiResource<Category[]>('/catalog/categories');
  const [slug, setSlug] = useState<string | null>(null);
  return <Screen title="Explore Cover" grid><ResourceState {...resource} />
    {resource.data?.length === 0 ? <Copy>No categories are available yet.</Copy> : null}
    <ListDetail selected={!!slug} onBack={() => setSlug(null)} list={resource.data?.map(category => <Card key={category.id}>
      <Copy>{category.name}</Copy><Badge label={CATEGORY_AVAILABILITY[category.availability].label} tone={CATEGORY_AVAILABILITY[category.availability].tone} />
      <Button title={`Explore ${category.name}`} secondary={slug !== category.slug} onPress={() => setSlug(category.slug)} />
    </Card>)} detail={slug ? <Detail key={slug} slug={slug} /> : <Copy>Choose a category to see details and get a quote.</Copy>} />
  </Screen>;
}
